import Player from "./Player.js";
import SubBass from "../effects/SubBass";
import {allOrNone} from '../util';

let emu = null;
let libgme = null;
const INT16_MAX = 65535;
const fileExtensions = [
  'nsf',
  'nsfe',
  'spc',
  'gym',
  'vgm',
  'vgz',
  'ay',
  'sgc',
  'kss',
  'gbs',
];

export default class GMEPlayer extends Player {
  constructor(chipCore, sampleRate) {
    super(chipCore, sampleRate);
    this.setParameter = this.setParameter.bind(this);
    this.getParameter = this.getParameter.bind(this);
    this.getParamDefs = this.getParamDefs.bind(this);

    libgme = chipCore;
    this.paused = false;
    this.fileExtensions = fileExtensions;
    this.subtune = 0;
    this.tempo = 1.0;
    this.params = { subbass: 1 };
    this.voiceMask = []; // GME does not expose a method to get the current voice mask
    this.buffer = libgme.allocate(16384, 'i16', libgme.ALLOC_NORMAL);
    this.subBass = new SubBass(sampleRate);
    this.setAudioProcess(this.gmeAudioProcess);
  }

  gmeAudioProcess = (channels) => {
    const bufferSize = channels[0].length;
    if (this.paused || !emu) {
      for (let ch = 0; ch < channels.length; ch++) {
        channels[ch].fill(0);
      }
      return;
    }

    if (this.getPositionMs() >= this.getDurationMs() && this.fadingOut === false) {
      console.log('Fading out at %d ms.', this.getPositionMs());
      this.setFadeout(this.getPositionMs());
      this.fadingOut = true;
    }

    if (libgme._gme_track_ended(emu) !== 1) {
      libgme._gme_play(emu, bufferSize * 2, this.buffer);

      for (let ch = 0; ch < channels.length; ch++) {
        for (let i = 0; i < bufferSize; i++) {
          channels[ch][i] = libgme.getValue(this.buffer +
            // Interleaved channel format
            i * 2 * 2 +             // frame offset   * bytes per sample * num channels +
            ch * 2,                 // channel offset * bytes per sample
            'i16') / INT16_MAX;     // convert int16 to float
        }
      }

      if (this.params.subbass > 0) {
        for (let i = 0; i < bufferSize; i++) {
          const sub = this.subBass.process(channels[0][i]) * this.params.subbass;
          for (let ch = 0; ch < channels.length; ch++) {
            channels[ch][i] += sub;
          }
        }
      }
    } else {
      this.subtune++;

      if (this.subtune >= libgme._gme_track_count(emu) || this.playSubtune(this.subtune) !== 0) {
        this.suspend();
        console.debug(
          'GMEPlayer.process(): _gme_track_ended == %s and subtune (%s) > _gme_track_count (%s).',
          libgme._gme_track_ended(emu),
          this.subtune,
          libgme._gme_track_count(emu)
        );
        this.emit('playerStateUpdate', { isStopped: true });
      }
    }
  }

  playSubtune(subtune) {
    this.fadingOut = false;
    this.subtune = subtune;
    this.metadata = this._parseMetadata(subtune);
    console.debug('GMEPlayer.playSubtune(subtune=%s)', subtune);
    this.emit('playerStateUpdate', {
      ...this.getBasePlayerState(),
      isStopped: false,
      subtune: this.getSubtune(),
      numSubtunes: this.getNumSubtunes(),
    });
    return libgme._gme_start_track(emu, subtune);
  }

  loadData(data, filepath) {
    this.subtune = 0;
    this.fadingOut = false;
    this.filepathMeta = Player.metadataFromFilepath(filepath);
    const formatNeedsBass = filepath.match(
      /(\.sgc$|\.kss$|\.nsfe?$|\.ay$|Master System|Game Gear)/i
    );
    this.params.subbass = formatNeedsBass ? 1 : 0;

    const emuPtr = libgme.allocate(1, 'i32', libgme.ALLOC_NORMAL);
    if (libgme.ccall(
      "gme_open_data",
      "number",
      ["array", "number", "number", "number"],
      [data, data.length, emuPtr, this.sampleRate]
    ) !== 0) {
      console.error("gme_open_data failed.");
      this.stop();
      throw Error('Unable to load this file!');
    }
    emu = libgme.getValue(emuPtr, "i32");
    this.voiceMask = Array(libgme._gme_voice_count(emu)).fill(true);

    this.resume();
    if (this.playSubtune(this.subtune) !== 0) {
      console.error("gme_start_track failed.");
      throw Error('Unable to play this subtune!');
    }
  }

  _parseMetadata(subtune) {
    const metadataPtr = libgme.allocate(1, "i32", libgme.ALLOC_NORMAL);
    if (libgme._gme_track_info(emu, metadataPtr, subtune) !== 0)
      console.error("could not load metadata");
    const ref = libgme.getValue(metadataPtr, "*");

    let offset = 0;

    const readInt32 = function () {
      var value = libgme.getValue(ref + offset, "i32");
      offset += 4;
      return value;
    };

    const readString = function () {
      let value = '';

      // Interpret as UTF8 (disabled)
      // value = libgme.UTF8ToString(libgme.getValue(ref + offset, "i8*"));

      // Interpret as ISO-8859-1 (unsigned integer values, 0 to 255)
      const ptr = libgme.getValue(ref + offset, 'i8*');
      for (let i = 0; i < 255; i++) {
        let char = libgme.getValue(ptr + i, 'i8');
        if (char === 0) {
          break;
        } else if (char < 0) {
          char = (Math.abs(char) ^ 255) + 1;
        }
        value += String.fromCharCode(char);
      }

      offset += 4;
      return value;
    };

    const meta = {};

    meta.length = readInt32();
    meta.intro_length = readInt32();
    meta.loop_length = readInt32();
    meta.play_length = readInt32();

    offset += 4 * 12; // skip unused bytes

    meta.system = readString();
    meta.game = readString();
    meta.title = readString() || meta.game || this.filepathMeta.title;
    meta.artist = readString() || this.filepathMeta.artist;
    meta.copyright = readString();
    meta.comment = readString();

    meta.formatted = {
      title: meta.game === meta.title ?
        meta.title :
        allOrNone(meta.game, ' - ') + meta.title,
      subtitle: [meta.artist, meta.system].filter(x => x).join(' - ') +
        allOrNone(' (', meta.copyright, ')'),
    };

    return meta;
  }

  getVoiceName(index) {
    if (emu) return libgme.UTF8ToString(libgme._gme_voice_name(emu, index));
  }

  getNumVoices() {
    if (emu) return libgme._gme_voice_count(emu);
  }

  getNumSubtunes() {
    if (emu) return libgme._gme_track_count(emu);
  }

  getSubtune() {
    return this.subtune;
  }

  getPositionMs() {
    if (emu) return libgme._gme_tell_scaled(emu);
    return 0;
  }

  getDurationMs() {
    if (emu) return this.metadata.play_length;
    return 0;
  }

  getMetadata() {
    return this.metadata;
  }

  getParameter(id) {
    return this.params[id];
  }

  getParamDefs() {
    return [
      {
        id: 'subbass',
        label: 'Sub Bass',
        type: 'number',
        min: 0.0,
        max: 2.0,
        step: 0.01,
        value: 1.0,
      },
    ];
  }

  setParameter(id, value) {
    switch (id) {
      case 'subbass':
        this.params[id] = parseFloat(value);
        break;
      default:
        console.warn('GMEPlayer has no parameter with id "%s".', id);
    }
  }

  isPlaying() {
    return !this.isPaused() && libgme._gme_track_ended(emu) !== 1;
  }

  getTempo() {
    return this.tempo;
  }

  setTempo(val) {
    this.tempo = val;
    if (emu) libgme._gme_set_tempo(emu, val);
  }

  setFadeout(startMs) {
    if (emu) libgme._gme_set_fade(emu, startMs, 4000);
  }

  getVoiceMask() {
    return this.voiceMask;
  }

  setVoiceMask(voiceMask) {
    if (emu) {
      let bitmask = 0;
      voiceMask.forEach((isEnabled, i) => {
        if (!isEnabled) {
          bitmask += 1 << i;
        }
      });
      libgme._gme_mute_voices(emu, bitmask);
      this.voiceMask = voiceMask;
    }
  }

  seekMs(positionMs) {
    if (emu) {
      this.muteAudioDuringCall(() =>
        libgme._gme_seek_scaled(emu, positionMs));
    }
  }

  stop() {
    this.suspend();
    if (emu) libgme._gme_delete(emu);
    emu = null;
    console.debug('GMEPlayer.stop()');
    this.emit('playerStateUpdate', { isStopped: true });
  }
}
