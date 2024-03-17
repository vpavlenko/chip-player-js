import autoBindReact from "auto-bind/react";
import { initializeApp as firebaseInitializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore/lite";
import isMobile from "ismobilejs";
import clamp from "lodash/clamp";
import path from "path";
import queryString from "querystring";
import React from "react";
import Dropzone from "react-dropzone";
import { Redirect, Route, Switch, withRouter } from "react-router-dom";

import requestCache from "../RequestCache";
import Sequencer, { NUM_REPEAT_MODES, REPEAT_OFF } from "../Sequencer";
import ChipCore from "../chip-core";
import {
  API_BASE,
  ERROR_FLASH_DURATION_MS,
  MAX_VOICES,
  SOUNDFONT_MOUNTPOINT,
} from "../config";
import firebaseConfig from "../config/firebaseConfig";
import {
  ensureEmscFileWithData,
  getMetadataUrlForCatalogUrl,
  unlockAudioContext,
} from "../util";

import MIDIPlayer from "../players/MIDIPlayer";

import defaultAnalyses from "../corpus/analyses.json";
import Alert from "./Alert";
import AppFooter from "./AppFooter";
import AppHeader from "./AppHeader";
import Browse from "./Browse";
import DropMessage from "./DropMessage";
import MessageBox from "./MessageBox";
import Visualizer from "./Visualizer";
import Axes from "./rawl/Axes";
import { ColorSchemeProvider } from "./rawl/ColorScheme";
import Rawl from "./rawl/Rawl";
import TagSearch from "./rawl/TagSearch";
import Course from "./rawl/course/Course";
import DAW from "./rawl/pages/DAW";

const mergeAnalyses = (base, diff) => {
  const result = { ...base };

  for (const game in diff) {
    if (!result[game]) {
      result[game] = {};
    }

    for (const file in diff[game]) {
      if (!result[game][file]) {
        result[game][file] = {};
      }

      for (const subtune in diff[game][file]) {
        result[game][file][subtune] = diff[game][file][subtune];
      }
    }
  }

  return result;
};

class App extends React.Component {
  constructor(props) {
    super(props);
    autoBindReact(this);

    this.attachMediaKeyHandlers();
    this.contentAreaRef = React.createRef();
    this.playContexts = {};
    this.errorTimer = null;
    this.midiPlayer = null; // Need a reference to MIDIPlayer to handle SoundFont loading.
    window.ChipPlayer = this;

    // Initialize Firebase
    const firebaseApp = firebaseInitializeApp(firebaseConfig);
    const auth = getAuth(firebaseApp);
    this.db = getFirestore(firebaseApp);

    // Load the analyses by Vitaly Pavlenko
    const docRef = doc(this.db, "users", "hqAWkYyzu2hIzNgE3ui89f41vFA2");
    getDoc(docRef).then((userSnapshot) => {
      if (userSnapshot.exists() && userSnapshot.data().analyses) {
        // if (this.state.analyses == defaultAnalyses) {
        this.setState({
          analyses: mergeAnalyses(
            defaultAnalyses,
            userSnapshot.data().analyses,
          ),
        });
        // }
        // else: analyses of some other user have already been loaded, leave them intact
      }
    });

    onAuthStateChanged(auth, (user) => {
      this.setState({
        user,
        loadingUser: !!user,
        // analysisEnabled: !!user,
      });
      if (user) {
        const docRef = doc(this.db, "users", user.uid);
        getDoc(docRef)
          .then((userSnapshot) => {
            if (!userSnapshot.exists()) {
              // Create user
              console.debug("Creating user document", user.uid);
              setDoc(docRef, {
                faves: [],
                settings: {},
                user: {
                  email: user.email,
                },
              });
            } else {
              // Restore user
              const data = userSnapshot.data();
              this.setState({
                faves: data.faves || [],
                // analyses: data.analyses,
              });
            }
          })
          .finally(() => {
            this.setState({ loadingUser: false });
          });
      }
    });

    // Initialize audio graph
    // ┌────────────┐      ┌────────────┐      ┌─────────────┐
    // │ playerNode ├─────>│  gainNode  ├─────>│ destination │
    // └────────────┘      └────────────┘      └─────────────┘
    const audioCtx =
      (this.audioCtx =
      window.audioCtx =
        new (window.AudioContext || window.webkitAudioContext)({
          latencyHint: "playback",
        }));
    const bufferSize = Math.max(
      // Make sure script node bufferSize is at least baseLatency
      Math.pow(
        2,
        Math.ceil(
          Math.log2((audioCtx.baseLatency || 0.001) * audioCtx.sampleRate),
        ),
      ),
      16384, // can set to 16384, but the cursor will lag. smooth is 2048
    );
    const gainNode = (this.gainNode = audioCtx.createGain());
    gainNode.gain.value = 1;
    gainNode.connect(audioCtx.destination);
    const playerNode = (this.playerNode = audioCtx.createScriptProcessor(
      bufferSize,
      0,
      2,
    ));
    playerNode.connect(gainNode);

    unlockAudioContext(audioCtx);
    console.log(
      "Sample rate: %d hz. Base latency: %d. Buffer size: %d.",
      audioCtx.sampleRate,
      audioCtx.baseLatency * audioCtx.sampleRate,
      bufferSize,
    );

    let latencyCorrectionMs = parseInt(
      localStorage.getItem("latencyCorrectionMs"),
      10,
    );
    latencyCorrectionMs =
      !isNaN(latencyCorrectionMs) && latencyCorrectionMs !== null
        ? latencyCorrectionMs
        : 600;

    this.state = {
      loading: true,
      loadingUser: true,
      paused: true,
      ejected: true,
      playerError: null,
      currentSongMetadata: {},
      currentSongNumVoices: 0,
      currentSongNumSubtunes: 0,
      currentSongSubtune: 0,
      currentSongDurationMs: 1,
      currentSongPositionMs: 0,
      tempo: 1,
      voiceMask: Array(MAX_VOICES).fill(true),
      voiceNames: Array(MAX_VOICES).fill(""),
      imageUrl: null,
      infoTexts: [],
      showInfo: false,
      showPlayerError: false,
      showPlayerSettings: true,
      user: null,
      faves: [],
      songUrl: null,
      volume: 100,
      repeat: REPEAT_OFF,
      directories: {},
      hasPlayer: false,
      paramDefs: [],
      parsings: {},
      analysisEnabled: false,
      analyses: defaultAnalyses,
      latencyCorrectionMs,
    };

    this.initChipCore(audioCtx, playerNode, bufferSize);
  }

  async initChipCore(audioCtx, playerNode, bufferSize) {
    // Load the chip-core Emscripten runtime
    try {
      this.chipCore = await new ChipCore({
        // Look for .wasm file in web root, not the same location as the app bundle (static/js).
        locateFile: (path, prefix) => {
          if (path.endsWith(".wasm") || path.endsWith(".wast"))
            return `${process.env.PUBLIC_URL}/${path}`;
          return prefix + path;
        },
        print: (msg) => console.debug("[stdout] " + msg),
        printErr: (msg) => console.debug("[stderr] " + msg),
      });
    } catch (e) {
      // Browser doesn't support WASM (Safari in iOS Simulator)
      Object.assign(this.state, {
        playerError: "Error loading player engine. Old browser?",
        loading: false,
      });
      return;
    }

    // Get debug from location.search
    const debug = queryString.parse(window.location.search.substring(1)).debug;
    // Create all the players. Players will set up IDBFS mount points.
    const self = this;
    const players = [MIDIPlayer].map(
      (P) =>
        new P(
          this.chipCore,
          audioCtx.sampleRate,
          bufferSize,
          debug,
          (parsing) =>
            self.setState((prevState) => ({
              parsings: { ...prevState.parsings, [this.browsePath]: parsing },
            })),
          this.togglePause,
        ),
    );
    this.midiPlayer = players[0];

    // Set up the central audio processing callback. This is where the magic happens.
    playerNode.onaudioprocess = (e) => {
      const channels = [];
      for (let i = 0; i < e.outputBuffer.numberOfChannels; i++) {
        channels.push(e.outputBuffer.getChannelData(i));
      }
      for (let player of players) {
        if (player.stopped) continue;
        player.processAudio(channels);
      }
    };

    // Populate all mounted IDBFS file systems from IndexedDB.
    this.chipCore.FS.syncfs(true, (err) => {
      if (err) {
        console.log("Error populating FS from indexeddb.", err);
      }
      players.forEach((player) => player.handleFileSystemReady());
    });

    this.sequencer = new Sequencer(players, this.props.history);
    this.sequencer.on("sequencerStateUpdate", this.handleSequencerStateUpdate);
    this.sequencer.on("playerError", this.handlePlayerError);

    // TODO: Move to separate processUrlParams method.
    const urlParams = queryString.parse(window.location.search.substring(1));
    if (urlParams.play) {
      const play = urlParams.play;
      const dirname = path.dirname(urlParams.play);
      // Treat play param as a "transient command" and strip it away after starting playback.
      // See comment in Browse.js for more about why a sticky play param is not a good idea.
      delete urlParams.play;
      const qs = queryString.stringify(urlParams);
      const search = qs ? `?${qs}` : "";
      // Navigate to song's containing folder. History comes from withRouter().
      this.fetchDirectory(dirname).then(() => {
        this.props.history.replace(`/browse/${dirname}${search}`);
        const index = this.playContexts[dirname].indexOf(play);
        this.playContext(this.playContexts[dirname], index);

        if (urlParams.t) {
          setTimeout(() => {
            if (this.sequencer.getPlayer()) {
              this.sequencer.getPlayer().seekMs(parseInt(urlParams.t, 10));
            }
          }, 100);
        }
      });
    }

    this.setState({ loading: false });
  }

  static mapSequencerStateToAppState(sequencerState) {
    const map = {
      ejected: "isEjected",
      paused: "isPaused",
      currentSongSubtune: "subtune",
      currentSongMetadata: "metadata",
      currentSongNumVoices: "numVoices",
      currentSongPositionMs: "positionMs",
      currentSongDurationMs: "durationMs",
      currentSongNumSubtunes: "numSubtunes",
      tempo: "tempo",
      voiceNames: "voiceNames",
      voiceMask: "voiceMask",
      songUrl: "url",
      hasPlayer: "hasPlayer",
      // TODO: add param values? move to paramStateUpdate?
      paramDefs: "paramDefs",
      infoTexts: "infoTexts",
    };
    const appState = {};
    for (let prop in map) {
      const seqProp = map[prop];
      if (seqProp in sequencerState) {
        appState[prop] = sequencerState[seqProp];
      }
    }
    return appState;
  }

  handleLogin() {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    signInWithPopup(auth, provider)
      .then((result) => {
        console.log("Firebase auth result:", result);
      })
      .catch((error) => {
        console.log("Firebase auth error:", error);
      });
  }

  handleLogout() {
    const auth = getAuth();
    signOut(auth).then(() => {
      this.setState({
        user: null,
        faves: [],
      });
    });
  }

  async saveAnalysis(analysis) {
    const currIdx = this.sequencer?.getCurrIdx();
    if (currIdx === undefined) return;

    const path =
      this.playContexts[this.browsePath] &&
      this.playContexts[this.browsePath][currIdx];
    const subtune = this.state.currentSongSubtune;
    if (!path) return;

    // hack .__.
    const lastSlashIndex = path.lastIndexOf("/");
    const beforeSlash = path.substring(0, lastSlashIndex);
    const song = path.substring(lastSlashIndex + 1);

    const user = this.state.user;
    if (user) {
      const userRef = doc(this.db, "users", user.uid);
      const userDoc = await getDoc(userRef);

      let userData = userDoc.exists ? userDoc.data() : {};

      const diff = {
        [beforeSlash]: { [song]: { [subtune]: analysis } },
      };
      userData.analyses = mergeAnalyses(userData.analyses ?? {}, diff);

      await setDoc(userRef, userData).catch((e) => {
        console.log("Couldn't save analysis.", e);
        alert("Could not save analysis");
      });

      this.setState((prevState) => ({
        analyses: mergeAnalyses(prevState.analyses, diff),
      }));

      const tonicRef = doc(this.db, "tonics", this.sequencer.hash);
      const tonicData = {
        path,
        tonic: analysis.tonic,
      };
      if (Object.keys(analysis.modulations).length > 0) {
        tonicData.modulations = analysis.modulations;
      }
      await setDoc(tonicRef, tonicData).catch((e) => {
        console.log("Couldn't save tonic.", e);
        alert("Could not save tonic");
      });
    }
  }

  attachMediaKeyHandlers() {
    if ("mediaSession" in navigator) {
      console.log("Attaching Media Key event handlers.");

      // Limitations of MediaSession: there must always be an active audio element.
      // See https://bugs.chromium.org/p/chromium/issues/detail?id=944538
      //     https://github.com/GoogleChrome/samples/issues/637
      this.mediaSessionAudio = document.createElement("audio");
      this.mediaSessionAudio.src =
        process.env.PUBLIC_URL + "/5-seconds-of-silence.mp3";
      this.mediaSessionAudio.loop = true;
      this.mediaSessionAudio.volume = 0;

      navigator.mediaSession.setActionHandler("play", () => this.togglePause());
      navigator.mediaSession.setActionHandler("pause", () =>
        this.togglePause(),
      );
      navigator.mediaSession.setActionHandler("seekbackward", () =>
        this.seekRelative(-5000),
      );
      navigator.mediaSession.setActionHandler("seekforward", () =>
        this.seekRelative(5000),
      );
    }

    document.addEventListener("keydown", (e) => {
      // Keyboard shortcuts: tricky to get it just right and keep the browser behavior intact.
      // The order of switch-cases matters. More privileged keys appear at the top.
      // More restricted keys appear at the bottom, after various input focus states are filtered out.
      if (e.ctrlKey || e.metaKey) return; // avoid browser keyboard shortcuts

      switch (e.key) {
        case "Escape":
          this.setState({ showInfo: false });
          e.target.blur();
          break;
        default:
      }

      if (e.target.tagName === "INPUT" && e.target.type === "text") return; // text input has focus

      switch (e.key) {
        case " ":
          this.togglePause();
          e.preventDefault();
          break;
        case "-":
          this.setSpeedRelative(-0.1);
          break;
        case "_":
          this.setSpeedRelative(-0.01);
          break;
        case "=":
          this.setSpeedRelative(0.1);
          break;
        case "+":
          this.setSpeedRelative(0.01);
          break;
        case "f":
          this.enterFullScreen();
        default:
      }

      if (e.target.tagName === "INPUT" && e.target.type === "range") return; // a range slider has focus

      switch (e.key) {
        case "ArrowLeft":
          this.seekRelative(-5000);
          e.preventDefault();
          break;
        case "ArrowRight":
          this.seekRelative(5000);
          e.preventDefault();
          break;
        default:
      }
    });
  }

  playContext(context, index = 0, subtune = 0) {
    this.sequencer.playContext(context, index, subtune);
  }

  handleSequencerStateUpdate(sequencerState) {
    const { isEjected } = sequencerState;
    console.log("App.handleSequencerStateUpdate(isEjected=%s)", isEjected);

    if (isEjected) {
      this.setState({
        ejected: true,
        currentSongSubtune: 0,
        currentSongMetadata: {},
        currentSongNumVoices: 0,
        currentSongPositionMs: 0,
        currentSongDurationMs: 1,
        currentSongNumSubtunes: 0,
        imageUrl: null,
        songUrl: null,
      });
      // TODO: Disabled to support scroll restoration.
      // updateQueryString({ play: undefined });

      if ("mediaSession" in navigator) {
        this.mediaSessionAudio.pause();

        navigator.mediaSession.playbackState = "none";
        if ("MediaMetadata" in window) {
          navigator.mediaSession.metadata = new window.MediaMetadata({});
        }
      }
    } else {
      const player = this.sequencer.getPlayer();
      const url = this.sequencer.getCurrUrl();
      if (url) {
        const metadataUrl = getMetadataUrlForCatalogUrl(url);
        // TODO: Disabled to support scroll restoration.
        // const filepath = url.replace(CATALOG_PREFIX, '');
        // updateQueryString({ play: filepath, t: undefined });
        // TODO: move fetch metadata to Player when it becomes event emitter
        requestCache
          .fetchCached(metadataUrl)
          .then((response) => {
            const { imageUrl, infoTexts } = response;
            const newInfoTexts = [...infoTexts, ...this.state.infoTexts];
            this.setState({ imageUrl, infoTexts: newInfoTexts });

            if ("mediaSession" in navigator) {
              // Clear artwork if imageUrl is null.
              navigator.mediaSession.metadata.artwork =
                imageUrl == null
                  ? []
                  : [
                      {
                        src: imageUrl,
                        sizes: "512x512",
                      },
                    ];
            }
          })
          .catch((e) => {
            this.setState({ imageUrl: null });
          });
      }

      const metadata = player.getMetadata();

      if ("mediaSession" in navigator) {
        this.mediaSessionAudio.play();

        if ("MediaMetadata" in window) {
          navigator.mediaSession.metadata = new window.MediaMetadata({
            title: metadata.title || metadata.formatted?.title,
            artist: metadata.artist || metadata.formatted?.subtitle,
            album: metadata.game,
            artwork: [],
          });
        }
      }

      this.setState({
        ...App.mapSequencerStateToAppState(sequencerState),
        showInfo: false,
      });
    }
  }

  handlePlayerError(message) {
    if (message) this.setState({ playerError: message });
    this.setState({ showPlayerError: !!message });
    clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(
      () => this.setState({ showPlayerError: false }),
      ERROR_FLASH_DURATION_MS,
    );
  }

  togglePause() {
    if (this.state.ejected || !this.sequencer.getPlayer()) return;

    const paused = this.sequencer.getPlayer().togglePause();
    if ("mediaSession" in navigator) {
      if (paused) {
        this.mediaSessionAudio.pause();
      } else {
        this.mediaSessionAudio.play();
      }
    }
    this.setState({ paused: paused });
  }

  toggleSettings() {
    this.setState({ showPlayerSettings: !this.state.showPlayerSettings });

    // I save it here as a memory on how to save anything on a user's account.
    //
    // const user = this.state.user;
    // if (user) {
    //   const userRef = doc(this.db, "users", user.uid);
    //   updateDoc(userRef, {
    //     settings: { showPlayerSettings: showPlayerSettings },
    //   }).catch((e) => {
    //     console.log("Couldn't update settings in Firebase.", e);
    //   });
    // }
  }

  handleTimeSliderChange(event) {
    if (!this.sequencer.getPlayer()) return;

    const pos = event.target ? event.target.value : event;
    const seekMs = Math.floor(pos * this.state.currentSongDurationMs);

    this.seekRelativeInner(seekMs);
  }

  seekRelative(ms) {
    if (!this.sequencer.getPlayer()) return;

    const durationMs = this.state.currentSongDurationMs;
    const seekMs = clamp(
      this.sequencer.getPlayer().getPositionMs() + ms,
      0,
      durationMs,
    );

    this.seekRelativeInner(seekMs);
  }

  seekRelativeInner(seekMs, firedByChiptheory = false) {
    if (!firedByChiptheory && this.state.seekCallback) {
      this.state.seekCallback(seekMs);
    }
    this.sequencer.getPlayer().seekMs(seekMs);
    this.setState({
      currentSongPositionMs: seekMs, // Smooth
    });
    setTimeout(() => {
      if (this.sequencer.getPlayer().isPlaying()) {
        this.setState({
          currentSongPositionMs: this.sequencer.getPlayer().getPositionMs(), // Accurate
        });
      }
    }, 100);
  }

  handleSetVoiceMask(voiceMask) {
    if (!this.sequencer.getPlayer()) return;

    this.sequencer.getPlayer().setVoiceMask(voiceMask);
    this.setState({ voiceMask: [...voiceMask] });
  }

  handleTempoChange(event) {
    if (!this.sequencer.getPlayer()) return;

    const tempo = parseFloat(event.target ? event.target.value : event) || 1.0;
    this.sequencer.getPlayer().setTempo(tempo);
    this.setState({
      tempo: tempo,
    });
  }

  setSpeedRelative(delta) {
    if (!this.sequencer.getPlayer()) return;

    const tempo = clamp(this.state.tempo + delta, 0.1, 2);
    this.sequencer.getPlayer().setTempo(tempo);
    this.setState({
      tempo: tempo,
    });
  }

  handleSongClick(url, context, index, subtune = 0) {
    return (e) => {
      e.preventDefault();
      if (context) {
        this.playContext(context, index, subtune);
      } else {
        this.sequencer.playSonglist([url]);
      }
    };
  }

  handleVolumeChange(volume) {
    this.setState({ volume });
    this.gainNode.gain.value = Math.max(0, Math.min(2, volume * 0.01));
  }

  handleCycleRepeat() {
    // TODO: Handle dropped file repeat
    const repeat = (this.state.repeat + 1) % NUM_REPEAT_MODES;
    this.setState({ repeat });
    this.sequencer.setRepeat(repeat);
  }

  toggleInfo() {
    this.setState({
      showInfo: !this.state.showInfo,
    });
  }

  processFetchedDirectory(path, items) {
    this.playContexts[path] = items
      .filter((item) => item.type === "file")
      .map((item) =>
        item.path.replace("%", "%25").replace("#", "%23").replace(/^\//, ""),
      );
    const directories = {
      ...this.state.directories,
      [path]: items,
    };
    this.setState({ directories });
  }

  fetchDirectory(path) {
    if (path.startsWith("static")) {
      const items = [
        {
          idx: 0,
          path: "/static/Yes/Close_to_the_edge.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 1,
          path: "/static/Yes/To_be_over.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 2,
          path: "/static/bushgrafts/funny val solo.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 3,
          path: "/static/Lena/Merry_Go_Round_of_Life_Howls_Moving_Castle_Piano_Tutorial_.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 4,
          path: "/static/Lena/One_Summers_Day_Spirited_Away.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 5,
          path: "/static/Daniil/Sviridov_Time_Foward.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 6,
          path: "/static/Daniil/pornofilmy-prosti_proshyay_privet.1.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 7,
          path: "/static/Daniil/pornofilmy-prosti_proshyay_privet.2.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 8,
          path: "/static/Daniil/pornofilmy-prosti_proshyay_privet.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 9,
          path: "/static/Daniil/pornofilmy-ya_tak_soskuchilsya.1.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 10,
          path: "/static/Daniil/pornofilmy-ya_tak_soskuchilsya.2.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 11,
          path: "/static/Daniil/pornofilmy-ya_tak_soskuchilsya.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 12,
          path: "/static/Daniil/vivaldi_summer_part1.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 13,
          path: "/static/Daniil/vivaldi_summer_part2.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 14,
          path: "/static/Daniil/vivaldi_summer_part3.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 15,
          path: "/static/Daniil/vivaldi_summer_part3.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 16,
          path: "/static/Daniil/Vivaldi_-_Summer__The_Four_Seasons__-_Rousseau.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 17,
          path: "/static/Daniil/Sviridov_Time_Foward.1.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 18,
          path: "/static/blues_heads/Bags_Groove__Lead_sheet_.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 19,
          path: "/static/blues_heads/Billie_s_Bounce_Billies_Bounce.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 20,
          path: "/static/blues_heads/Blue_Rondo_A_La_Turk.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 21,
          path: "/static/blues_heads/Blues_for_Alice.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 22,
          path: "/static/blues_heads/Sandu.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 23,
          path: "/static/blues_heads/Blue_Monk_piano.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 24,
          path: "/static/blues_heads/Blues_in_the_Closet_Lead_sheet_.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 25,
          path: "/static/musescore_manual/Another_Love__-_Tom_Odell_Professional.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 26,
          path: "/static/musescore_manual/Canon_in_D.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 27,
          path: "/static/musescore_manual/Chopin_-_Nocturne_Op_9_No_2_E_Flat_Major.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 28,
          path: "/static/musescore_manual/Clair_de_Lune__Debussy.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 29,
          path: "/static/musescore_manual/Fr_Elise.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 30,
          path: "/static/musescore_manual/Game_of_Thrones_Easy_piano.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 31,
          path: "/static/musescore_manual/Golden_Hour__JVKE_Updated_Ver..mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 32,
          path: "/static/musescore_manual/Gymnopdie_No._1__Satie.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 33,
          path: "/static/musescore_manual/Hallelujah.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 34,
          path: "/static/musescore_manual/Interstellar.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 35,
          path: "/static/musescore_manual/Je_Te_Laisserai_Des_Mots_-_Patrick_Watson.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 36,
          path: "/static/musescore_manual/Merry_Go_Round_of_Life_Howls_Moving_Castle_Piano_Tutorial_.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 37,
          path: "/static/musescore_manual/One_Summers_Day_Spirited_Away.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 38,
          path: "/static/musescore_manual/Pirates_of_the_Caribbean_-_Hes_a_Pirate.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 39,
          path: "/static/musescore_manual/River_Flows_In_You.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 40,
          path: "/static/musescore_manual/Someone_You_Loved.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 41,
          path: "/static/musescore_manual/Sonate_No._14_Moonlight_1st_Movement.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 42,
          path: "/static/musescore_manual/Sonate_No._14_Moonlight_3rd_Movement.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 43,
          path: "/static/musescore_manual/Sweden_Minecraft.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 44,
          path: "/static/musescore_manual/Undertale_-_Megalovania_Piano_ver._3.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 45,
          path: "/static/musescore_manual/SENTINEL",
          size: 1337,
          type: "file",
        },
        {
          idx: 46,
          path: "/static/musescore_manual/All_I_Want_for_Christmas_is_You.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 47,
          path: "/static/musescore_manual/All_Of_Me_-_John_Legend_Piano_Cover_-_ReiK.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 48,
          path: "/static/musescore_manual/Attack_on_Titan_Shinzou_wo_Sasageyo.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 49,
          path: "/static/musescore_manual/Believer_-_Imagine_Dragons.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 50,
          path: "/static/musescore_manual/Bella_Ciao.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 51,
          path: "/static/musescore_manual/Carol_of_the_Bells.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 52,
          path: "/static/musescore_manual/Dawn_Pride_and_Prejudice.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 53,
          path: "/static/musescore_manual/Disney_Pixar_Up_Theme.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 54,
          path: "/static/musescore_manual/Ed_Sheeran_Perfect_THE_WORST_PIANO_ARRANGEMENT_I_HAVE_EVER_MADE.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 55,
          path: "/static/musescore_manual/Fallen_Down_Undertale.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 56,
          path: "/static/musescore_manual/Feliz_Navidad.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 57,
          path: "/static/musescore_manual/Fly_Me_to_the_Moon.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 58,
          path: "/static/musescore_manual/SENTINEL2",
          size: 1337,
          type: "file",
        },
        {
          idx: 59,
          path: "/static/musescore_manual/Godfather.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 60,
          path: "/static/musescore_manual/Gravity_Falls_Opening.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 61,
          path: "/static/musescore_manual/Jingle_Bell_Rock.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 62,
          path: "/static/musescore_manual/Jojo_s_Bizarre_Adventure_Golden_Wind_Giornos_Theme_Ver_2.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 63,
          path: "/static/musescore_manual/Kiss_The_Rain_-_Yiruma_-_10th_Anniversary_Version_Piano_Updated_2019.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 64,
          path: "/static/musescore_manual/Legend_of_Zelda_Great_Fairy_Fountain.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 65,
          path: "/static/musescore_manual/Let_It_Go_Disney_Frozen.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 66,
          path: "/static/musescore_manual/Liebestraum_No._3_in_A_Major.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 67,
          path: "/static/musescore_manual/Love_Like_You_Steven_Universe.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 68,
          path: "/static/musescore_manual/Love_Store_Francis_Lai.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 69,
          path: "/static/musescore_manual/Mad_world_Piano.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 70,
          path: "/static/musescore_manual/Mariage_dAmour.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 71,
          path: "/static/musescore_manual/Michael_Giaccino_Married_Life.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 72,
          path: "/static/musescore_manual/Moon_River_Breakfast_at_Tiffanys.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 73,
          path: "/static/musescore_manual/My_War_Attack_on_Titan.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 74,
          path: "/static/musescore_manual/Omori_Duet.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 75,
          path: "/static/musescore_manual/Pink_Panther.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 76,
          path: "/static/musescore_manual/Pokemon_Theme_Song.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 77,
          path: "/static/musescore_manual/Requiem_for_a_Dream.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 78,
          path: "/static/musescore_manual/Sadness_and_Sorrow.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 79,
          path: "/static/musescore_manual/Schindlers_List.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 80,
          path: "/static/musescore_manual/Someone_Like_You_easy_piano.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 81,
          path: "/static/musescore_manual/Summer_Joe_Hisaishi.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 82,
          path: "/static/musescore_manual/Super_Mario_Bros_Main_Theme.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 83,
          path: "/static/musescore_manual/Super_Mario_Bros_Peaches.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 84,
          path: "/static/musescore_manual/Test_Drive_How_to_Train_Your_Dragon.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 85,
          path: "/static/musescore_manual/Waltz_in_A_MinorChopin.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 86,
          path: "/static/musescore_manual/We_Dont_Talk_about_Bruno.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 87,
          path: "/static/musescore_manual/Wet_Hands_Minecraft.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 88,
          path: "/static/musescore_manual/Yann_Tiersen_Amelie.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 89,
          path: "/static/musescore_manual/Zeldas_Lullaby.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 90,
          path: "/static/musescore_manual/tude_S._1413_in_G_Minor_La_Campanella__Liszt.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 91,
          path: "/static/musescore_manual/A_Thousand_Miles.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 92,
          path: "/static/musescore_manual/Alone_Marshmello.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 93,
          path: "/static/musescore_manual/Avicii_Wake_me_up.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 94,
          path: "/static/musescore_manual/Avril_14_Aphex_Twin.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 95,
          path: "/static/musescore_manual/Axel_F_Beverly_Hills_Cop_III.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 96,
          path: "/static/musescore_manual/Billie_Eilish_Bad_Guy.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 97,
          path: "/static/musescore_manual/Bruno_Mars_When_I_was_your_man.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 98,
          path: "/static/musescore_manual/Cant_Help_Falling_In_Love.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 99,
          path: "/static/musescore_manual/Chris_Isaak_Wicked_Game.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 100,
          path: "/static/musescore_manual/Coffin_dance.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 101,
          path: "/static/musescore_manual/Despacito.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 102,
          path: "/static/musescore_manual/Dream_a_little_dream_of_me.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 103,
          path: "/static/musescore_manual/Ed_Sheeran_Shape_of_you.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 104,
          path: "/static/musescore_manual/Good_Bye_Hachiko.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 105,
          path: "/static/musescore_manual/Happy_Birthday_to_You.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 106,
          path: "/static/musescore_manual/Hit_the_Road_Jack.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 107,
          path: "/static/musescore_manual/How_long_blues.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 108,
          path: "/static/musescore_manual/Im_Blue_Eiffel_65.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 109,
          path: "/static/musescore_manual/John_Lennon_Imagine.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 110,
          path: "/static/musescore_manual/Johnny_Cash_Hurt.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 111,
          path: "/static/musescore_manual/Jolene.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 112,
          path: "/static/musescore_manual/Lady_Gaga_Always_remember_us_this_way.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 113,
          path: "/static/musescore_manual/Lena_Raine_Pigstep.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 114,
          path: "/static/musescore_manual/Let_Her_Go_Passenger.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 115,
          path: "/static/musescore_manual/Liana_Flores_Rises_the_Moon.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 116,
          path: "/static/musescore_manual/Lovely_Billie_Eilish.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 117,
          path: "/static/musescore_manual/Never_Gonna_Give_You_Up.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 118,
          path: "/static/musescore_manual/Ophelia.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 119,
          path: "/static/musescore_manual/Photograph_Ed_Sheeran.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 120,
          path: "/static/musescore_manual/Sweet_Dreams.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 121,
          path: "/static/musescore_manual/Sweet_home_Chicago.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 122,
          path: "/static/musescore_manual/Take_on_me.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 123,
          path: "/static/musescore_manual/TheFatRat_Monody.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 124,
          path: "/static/musescore_manual/TheFatRat_Unity.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 125,
          path: "/static/musescore_manual/The_Weeknd_Blinding_Lights.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 126,
          path: "/static/musescore_manual/Titanic.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 127,
          path: "/static/musescore_manual/Vangelis_Chariots_of_fire.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 128,
          path: "/static/musescore_manual/Viva_La_Vida_Coldplay.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 129,
          path: "/static/musescore_manual/Wellerman_Sea_Shanty.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 130,
          path: "/static/musescore_manual/Alice_DJ_Better_Off_Alone.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 131,
          path: "/static/musescore_manual/Sviridov_Snowstorm_Waltz.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 132,
          path: "/static/musescore_manual/Flight_Facilities_Crave_You.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 133,
          path: "/static/musescore_manual/Flight_Facilities_Crave_You_2.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 134,
          path: "/static/musescore_manual/Morphine_Cure_for_Pain.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 135,
          path: "/static/musescore_manual/The_Strokes_Reptilia.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 136,
          path: "/static/musescore_manual/The_Strokes_Reptilia_2.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 137,
          path: "/static/musescore_manual/The_Strokes_Reptilia_3.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 138,
          path: "/static/musescore_manual/Walking_On_a_dream.mid",
          size: 1337,
          type: "file",
        },
        {
          idx: 139,
          path: "/static/musescore_manual/You_and_whose_army.mid",
          size: 1337,
          type: "file",
        },
      ];
      return this.processFetchedDirectory(path, items);
    } else {
      return fetch(`${API_BASE}/browse?path=%2F${encodeURIComponent(path)}`)
        .then((response) => response.json())
        .then((items) => {
          return this.processFetchedDirectory(path, items);
        });
    }
  }

  onDrop = (droppedFiles) => {
    const reader = new FileReader();
    const file = droppedFiles[0];
    const ext = path.extname(file.name).toLowerCase();
    if (ext === ".sf2" && !this.midiPlayer) {
      this.handlePlayerError(
        "MIDIPlayer has not been created - unable to load SoundFont.",
      );
      return;
    }
    reader.onload = async () => {
      if (ext === ".sf2" && this.midiPlayer) {
        const sf2Path = `user/${file.name}`;
        const forceWrite = true;
        const isTransient = false;
        await ensureEmscFileWithData(
          this.chipCore,
          `${SOUNDFONT_MOUNTPOINT}/${sf2Path}`,
          new Uint8Array(reader.result),
          forceWrite,
        );
        this.midiPlayer.updateSoundfontParamDefs();
        this.midiPlayer.setParameter("soundfont", sf2Path, isTransient);
        // TODO: emit "paramDefsChanged" from player.
        // See https://reactjs.org/docs/integrating-with-other-libraries.html#integrating-with-model-layers
        this.forceUpdate();
      } else {
        const songData = reader.result;
        this.sequencer.playSongFile(file.name, songData);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  getCurrentPositionMs = () => {
    if (this.sequencer && this.sequencer.getPlayer()) {
      return this.sequencer.getPlayer().getPositionMs();
    }
    return 0;
  };

  setLatencyCorrectionMs = (latencyCorrectionMs) => {
    this.setState({ latencyCorrectionMs });
    localStorage.setItem("latencyCorrectionMs", latencyCorrectionMs);
  };

  render() {
    const currContext = this.sequencer?.getCurrContext();
    const currIdx = this.sequencer?.getCurrIdx();

    const browseRoute = (
      <Route
        path={["/browse/:browsePath*"]}
        render={({ history, match, location }) => {
          // Undo the react-router-dom double-encoded % workaround - see DirectoryLink.js
          const browsePath = match.params?.browsePath?.replace("%25", "%");
          const searchParams = new URLSearchParams(window.location.search);
          this.browsePath = browsePath;
          const path = this.playContexts[browsePath]?.[currIdx];
          const subtune = this.state.currentSongSubtune; // legacy from NES, always == '0' for MIDI
          const song = path?.substring(path.lastIndexOf("/") + 1);
          const savedAnalysis =
            this.state.analyses[browsePath]?.[song]?.[subtune];
          return (
            this.contentAreaRef.current && (
              <>
                <Browse
                  currContext={currContext}
                  currIdx={currIdx}
                  historyAction={history.action}
                  locationKey={location.key}
                  browsePath={browsePath}
                  listing={this.state.directories[browsePath]}
                  playContext={this.playContexts[browsePath]}
                  fetchDirectory={this.fetchDirectory}
                  handleSongClick={this.handleSongClick}
                  scrollContainerRef={this.contentAreaRef}
                  analyses={this.state.analyses}
                  sequencer={this.sequencer}
                />
                {(searchParams.get("song") || searchParams.get("link")) &&
                  this.state.parsings[browsePath] && (
                    <Rawl
                      parsingResult={this.state.parsings[browsePath]}
                      getCurrentPositionMs={this.getCurrentPositionMs}
                      savedAnalysis={savedAnalysis}
                      saveAnalysis={this.saveAnalysis}
                      voiceNames={this.state.voiceNames}
                      voiceMask={this.state.voiceMask}
                      setVoiceMask={this.handleSetVoiceMask}
                      showAnalysisBox={this.state.analysisEnabled}
                      seek={(time) => this.seekRelativeInner(time, true)}
                      registerSeekCallback={(seekCallback) =>
                        this.setState({ seekCallback })
                      }
                      synth={this.midiPlayer.midiFilePlayer.synth}
                      paused={this.state.paused}
                      artist={browsePath}
                      song={song}
                      exercise={searchParams.get("exercise")}
                      sequencer={this.sequencer}
                      setEnterFullScreen={(enterFullScreen) =>
                        (this.enterFullScreen = enterFullScreen)
                      }
                      latencyCorrectionMs={this.state.latencyCorrectionMs}
                    />
                  )}
              </>
            )
          );
        }}
      />
    );
    return (
      <ColorSchemeProvider>
        <Dropzone disableClick style={{}} onDrop={this.onDrop}>
          {(dropzoneProps) => (
            <div className="App">
              <DropMessage dropzoneProps={dropzoneProps} />
              <MessageBox
                showInfo={this.state.showInfo}
                infoTexts={this.state.infoTexts}
                toggleInfo={this.toggleInfo}
              />
              <Alert
                handlePlayerError={this.handlePlayerError}
                playerError={this.state.playerError}
                showPlayerError={this.state.showPlayerError}
              />
              <AppHeader isPhone={isMobile.phone} />
              <div className="App-main">
                <div className="App-main-inner">
                  <div className="App-main-content-and-settings">
                    <div
                      className="App-main-content-area"
                      ref={this.contentAreaRef}
                    >
                      <Switch>
                        <Route
                          path="/"
                          exact
                          render={() => <Redirect to="/course" />}
                        />
                        <Route
                          path="/axes"
                          render={() => <Axes sequencer={this.sequencer} />}
                        />
                        <Route
                          path="/course/:chapter*"
                          render={({ match }) => (
                            <Course
                              sequencer={this.sequencer}
                              chapter={match.params?.chapter}
                              analyses={this.state.analyses}
                            />
                          )}
                        />
                        <Route
                          path="/tags/:tag*"
                          render={({ match }) => (
                            <TagSearch
                              tag={match.params?.tag}
                              analyses={this.state.analyses}
                            />
                          )}
                        />
                        <Route path="/pages/daw" render={() => <DAW />} />
                        {browseRoute}
                      </Switch>
                    </div>
                  </div>
                </div>
                {!isMobile.phone && !this.state.loading && (
                  <Visualizer
                    audioCtx={this.audioCtx}
                    sourceNode={this.playerNode}
                    chipCore={this.chipCore}
                    settingsEnabled={this.state.showPlayerSettings}
                    handleToggleSettings={this.toggleSettings}
                    analysisEnabled={this.state.analysisEnabled}
                    handleToggleAnalysis={() =>
                      this.setState((state) => ({
                        analysisEnabled: !state.analysisEnabled,
                      }))
                    }
                    paused={this.state.ejected || this.state.paused}
                    user={this.state.user}
                    handleLogout={this.handleLogout}
                    handleLogin={this.handleLogin}
                  />
                )}
              </div>
              <AppFooter
                currentSongDurationMs={this.state.currentSongDurationMs}
                currentSongNumVoices={this.state.currentSongNumVoices}
                ejected={this.state.ejected}
                paused={this.state.paused}
                showPlayerSettings={this.state.showPlayerSettings}
                songUrl={this.state.songUrl}
                tempo={this.state.tempo}
                voiceNames={this.state.voiceNames}
                voiceMask={this.state.voiceMask}
                volume={this.state.volume}
                handleSetVoiceMask={this.handleSetVoiceMask}
                handleTempoChange={this.handleTempoChange}
                handleTimeSliderChange={this.handleTimeSliderChange}
                handleVolumeChange={this.handleVolumeChange}
                sequencer={this.sequencer}
                togglePause={this.togglePause}
                latencyCorrectionMs={this.state.latencyCorrectionMs}
                setLatencyCorrectionMs={this.setLatencyCorrectionMs}
              />
            </div>
          )}
        </Dropzone>
      </ColorSchemeProvider>
    );
  }
}

export default withRouter(App);
