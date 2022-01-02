import MIDIFile from 'midifile';
import MIDIFilePlayer from './MIDIFilePlayer';

import Player from './Player';
import { SOUNDFONTS, SOUNDFONT_MOUNTPOINT, SOUNDFONT_URL_PATH } from '../config';
import { ensureEmscFileWithUrl } from '../util';
import { GM_DRUM_KITS, GM_INSTRUMENTS } from '../gm-patch-map';
import debounce from 'lodash/debounce';

let lib = null;

const dummyMidiOutput = { send: () => {} };

const midiDevices = [
  dummyMidiOutput,
];

const fileExtensions = [
  'mid',
  'midi',
  'smf',
];

const MIDI_ENGINE_LIBFLUIDLITE = 0;
const MIDI_ENGINE_LIBADLMIDI = 1;
const MIDI_ENGINE_WEBMIDI = 2;

export default class MIDIPlayer extends Player {
  paramDefs = [
    {
      id: 'synthengine',
      label: 'Synth Engine',
      type: 'enum',
      options: [{
        label: 'MIDI Synthesis Engine',
        items: [
          {label: 'SoundFont (libFluidLite)', value: MIDI_ENGINE_LIBFLUIDLITE},
          {label: 'Adlib/OPL3 FM (libADLMIDI)', value: MIDI_ENGINE_LIBADLMIDI},
          {label: 'MIDI Device (Web MIDI)', value: MIDI_ENGINE_WEBMIDI},
        ],
      }],
      defaultValue: 0,
    },
    {
      id: 'soundfont',
      label: 'Soundfont',
      type: 'enum',
      options: SOUNDFONTS,
      defaultValue: SOUNDFONTS[0].items[0].value,
      dependsOn: {
        param: 'synthengine',
        value: MIDI_ENGINE_LIBFLUIDLITE,
      },
    },
    {
      id: 'reverb',
      label: 'Reverb',
      type: 'number',
      min: 0.0,
      max: 1.0,
      step: 0.01,
      defaultValue: 0.33,
      dependsOn: {
        param: 'synthengine',
        value: MIDI_ENGINE_LIBFLUIDLITE,
      },
    },
    {
      id: 'fluidpoly',
      label: 'Polyphony',
      type: 'number',
      min: 4,
      max: 256,
      step: 4,
      defaultValue: 128,
      dependsOn: {
        param: 'synthengine',
        value: MIDI_ENGINE_LIBFLUIDLITE,
      },
    },
    {
      id: 'opl3bank',
      label: 'OPL3 Bank',
      type: 'enum',
      options: [],
      defaultValue: 16, // Windows 95 bank
      dependsOn: {
        param: 'synthengine',
        value: MIDI_ENGINE_LIBADLMIDI,
      },
    },
    {
      id: 'mididevice',
      label: 'MIDI Device',
      type: 'enum',
      options: [{
        label: 'MIDI Output Devices',
        items: [{ label: 'Dummy device', value: 0 }],
      }],
      defaultValue: 0,
      dependsOn: {
        param: 'synthengine',
        value: MIDI_ENGINE_WEBMIDI,
      },
    },
    {
      id: 'autoengine',
      label: 'Auto Synth Engine Switching',
      hint: 'Switch synth engine based on filenames. Files containing "FM" will play through Adlib/OPL3 synth.',
      type: 'toggle',
      defaultValue: true,
    },
    {
      id: 'gmreset',
      label: 'GM Reset',
      hint: 'Send a GM Reset sysex and reset all controllers on all channels.',
      type: 'button',
    },
  ];

  constructor(chipCore, sampleRate) {
    super(chipCore, sampleRate);
    this.setParameter = this.setParameter.bind(this);
    this.getParameter = this.getParameter.bind(this);
    this.getParamDefs = this.getParamDefs.bind(this);
    this.switchSynthBasedOnFilename = this.switchSynthBasedOnFilename.bind(this);
    this.ensureWebMidiInitialized = this.ensureWebMidiInitialized.bind(this);

    lib = chipCore;
    lib._tp_init(sampleRate);
    this.sampleRate = sampleRate;

    // Initialize Soundfont filesystem
    lib.FS.mkdir(SOUNDFONT_MOUNTPOINT);
    const [ fs, fsName ] = typeof indexedDB != 'undefined' ? [ 'IDBFS', 'indexedDB' ] : [ 'MEMFS', 'MEMFS' ];
    lib.FS.mount(lib.FS.filesystems[fs], {}, SOUNDFONT_MOUNTPOINT);
    lib.FS.syncfs(true, (err) => {
      if (err) {
        console.log('Error populating FS from %s.', fsName, err);
      }
    });

    this.fileExtensions = fileExtensions;
    this.activeChannels = [];
    this.buffer = lib.allocate(this.bufferSize * 8, 'i32', lib.ALLOC_NORMAL);
    this.filepathMeta = {};
    this.midiFilePlayer = new MIDIFilePlayer({
      // playerStateUpdate is debounced to prevent flooding program change events
      // TODO: emit the program change in playerStateUpdate or paramStateUpdate event
      programChangeCb: () => debounce(() => this.emit('playerStateUpdate', { isStopped: false }), 200),
      output: dummyMidiOutput,
      skipSilence: true,
      sampleRate: this.sampleRate,
      synth: {
        // TODO: Consider removing the tiny player (tp), since a lot of MIDI is now implemented in JS.
        //       All it's really doing is hiding the FluidSynth and libADLMIDI insances behind a singleton.
        //       C object ("context") pointers could also be hidden at the JS layer, if those are annoying.
        //       The original benefit was to tie in tml.h (MIDI file reader) which is not used any more.
        //       Besides, MIDIPlayer.js already calls directly into libADLMIDI functions.
        noteOn: lib._tp_note_on,
        noteOff: lib._tp_note_off,
        pitchBend: lib._tp_pitch_bend,
        controlChange: lib._tp_control_change,
        programChange: lib._tp_program_change,
        panic: lib._tp_panic,
        panicChannel: lib._tp_panic_channel,
        render: lib._tp_render,
        reset: lib._tp_reset,
      },
    });

    // Populate OPL3 banks
    const numBanks = lib._adl_getBanksCount();
    const ptr = lib._adl_getBankNames();
    const oplBanks = [];
    for (let i = 0; i < numBanks; i++) {
      oplBanks.push({
        label: lib.UTF8ToString(lib.getValue(ptr + i * 4, '*')),
        value: i,
      });
    }
    this.paramDefs.find(def => def.id === 'opl3bank').options =
      [{ label: 'OPL3 Bank', items: oplBanks }];

    this.webMidiIsInitialized = false;
    // this.midiFilePlayer = new MIDIFilePlayer({ output: dummyMidiOutput });

    // Initialize parameters
    this.params = {};
    this.paramDefs.forEach(param => this.setParameter(param.id, param.defaultValue));

    this.setAudioProcess(this.midiAudioProcess);
  }

  midiAudioProcess(channels) {
    const useWebMIDI = this.params['synthengine'] === MIDI_ENGINE_WEBMIDI;

    const bufferSize = channels[0].length;

    if (this.midiFilePlayer.paused || useWebMIDI) {
      for (let ch = 0; ch < channels.length; ch++) {
        channels[ch].fill(0);
      }
    }

    if (useWebMIDI) {
      this.midiFilePlayer.processPlay();
    } else {
      if (this.midiFilePlayer.processPlaySynth(this.buffer, bufferSize)) {
        for (let ch = 0; ch < channels.length; ch++) {
          for (let i = 0; i < this.bufferSize; i++) {
            channels[ch][i] = lib.getValue(
              this.buffer +    // Interleaved channel format
              i * 4 * 2 +      // frame offset   * bytes per sample * num channels +
              ch * 4,          // channel offset * bytes per sample
              'float'
            );
          }
        }
      } else {
        this.stop();
      }
    }
  }

  metadataFromFilepath(filepath) {
    const parts = filepath.split('/');
    const len = parts.length;
    const meta = {};
    // HACK: MIDI metadata is guessed from filepath
    // based on the directory structure of Chip Player catalog.
    // Ideally, this data should be embedded in the MIDI files.
    if (parts.length >= 3) {
      meta.formatted = {
        title: `${parts[1]} - ${parts[len - 1]}`,
        subtitle: parts[0],
      };
    } else if (parts.length === 2) {
      meta.formatted = {
        title: parts[1],
        subtitle: parts[0],
      }
    } else {
      meta.formatted = {
        title: parts[0],
        subtitle: 'MIDI',
      }
    }
    return meta;
  }

  ensureWebMidiInitialized() {
    if (this.webMidiIsInitialized === true) return;
    this.webMidiIsInitialized = true;

    // Initialize MIDI output devices
    if (typeof navigator != 'undefined' && typeof navigator.requestMIDIAccess === 'function') {
      navigator.requestMIDIAccess({ sysex: true }).then((access) => {
        if (access.outputs.length === 0) {
          console.warn('No MIDI output devices found.');
        } else {
          [...access.outputs.values()].forEach(midiOutput => {
            console.log('MIDI Output:', midiOutput);
            midiDevices.push(midiOutput);
            this.paramDefs.find(def => def.id === 'mididevice').options[0].items.push({
              label: midiOutput.name,
              value: midiDevices.length - 1,
            });
          });

          // TODO: remove if removing Dummy Device
          this.setParameter('mididevice', 1);
        }
      });
    } else {
      console.warn('Web MIDI API not supported. Try Chrome if you want to use external MIDI output devices.');
    }
  }

  loadData(data, filepath) {
    this.ensureWebMidiInitialized();
    this.filepathMeta = this.metadataFromFilepath(filepath);

    if (this.getParameter('autoengine')) {
      this.switchSynthBasedOnFilename(filepath);
    }

    const midiFile = new MIDIFile(data);
    this.midiFilePlayer.load(midiFile);
    this.midiFilePlayer.play(() => this.emit('playerStateUpdate', { isStopped: true }));

    this.activeChannels = [];
    for (let i = 0; i < 16; i++) {
      if (this.midiFilePlayer.getChannelInUse(i)) this.activeChannels.push(i);
    }

    this.resume();
    this.emit('playerStateUpdate', {
      ...this.getBasePlayerState(),
      isStopped: false
    });
  }

  switchSynthBasedOnFilename(filepath) {
    // Switch to OPL3 engine if filepath contains 'FM'
    const fp = filepath.toLowerCase().replace('_', ' ');
    if (fp.match(/(\bfm|fm\b)/i)) {
      this.setParameter('synthengine', MIDI_ENGINE_LIBADLMIDI);
    } else {
      // this.setParameter('synthengine', MIDI_ENGINE_LIBFLUIDLITE);
    }

    // Crude bank matching for a few specific games. :D
    const opl3def = this.paramDefs.find(def => def.id === 'opl3bank');
    if (opl3def) {
      const opl3banks = opl3def.options[0].items;
      const findBank = (str) => opl3banks.findIndex(bank => bank.label.indexOf(str) > -1);
      let bankId = opl3def.defaultValue;
      if (fp.indexOf('[rick]') > -1) {
        bankId = findBank('Descent:: Rick');
      } else if (fp.indexOf('[ham]') > -1) {
        bankId = findBank('Descent:: Ham');
      } else if (fp.indexOf('[int]') > -1) {
        bankId = findBank('Descent:: Int');
      } else if (fp.indexOf('descent 2') > -1) {
        bankId = findBank('Descent 2');
      } else if (fp.indexOf('magic carpet') > -1) {
        bankId = findBank('Magic Carpet');
      } else if (fp.indexOf('wacky wheels') > -1) {
        bankId = findBank('Apogee IMF');
      } else if (fp.indexOf('warcraft 2') > -1) {
        bankId = findBank('Warcraft 2');
      } else if (fp.indexOf('warcraft') > -1) {
        bankId = findBank('Warcraft');
      } else if (fp.indexOf('system shock') > -1) {
        bankId = findBank('System Shock');
      }
      if (bankId > -1) {
        this.setParameter('opl3bank', bankId);
      }
    }
  }

  isPlaying() {
    return !this.midiFilePlayer.paused;
  }

  suspend() {
    super.suspend();
    this.midiFilePlayer.stop();
  }

  stop() {
    this.suspend();
    console.debug('MIDIPlayer.stop()');
    this.emit('playerStateUpdate', { isStopped: true });
  }

  togglePause() {
    return this.midiFilePlayer.togglePause();
  }

  getDurationMs() {
    return this.midiFilePlayer.getDuration();
  }

  getPositionMs() {
    return this.midiFilePlayer.getPosition();
  }

  seekMs(ms) {
    return this.midiFilePlayer.setPosition(ms);
  }

  getTempo() {
    return this.midiFilePlayer.getSpeed();
  }

  setTempo(tempo) {
    this.midiFilePlayer.setSpeed(tempo);
  }

  getNumVoices() {
    return this.activeChannels.length;
  }

  getVoiceName(index) {
    const ch = this.activeChannels[index];
    const pgm = this.midiFilePlayer.channelProgramNums[ch];
    return ch === 9 ? (GM_DRUM_KITS[pgm] || GM_DRUM_KITS[0]) : GM_INSTRUMENTS[pgm]
  }

  getVoiceMask() {
    return this.activeChannels.map(ch => this.midiFilePlayer.channelMask[ch]);
  }

  setVoiceMask(voiceMask) {
    voiceMask.forEach((isEnabled, i) => {
      const ch = this.activeChannels[i];
      this.midiFilePlayer.setChannelMute(ch, !isEnabled);
    });
  }

  getMetadata() {
    return this.filepathMeta;
  }

  getParameter(id) {
    if (id === 'fluidpoly') return lib._tp_get_polyphony();
    return this.params[id];
  }

  getParamDefs() {
    return this.paramDefs;
  }

  setParameter(id, value) {
    switch (id) {
      case 'synthengine':
        value = parseInt(value, 10);
        this.midiFilePlayer.panic();
        if (value === MIDI_ENGINE_WEBMIDI) {
          this.midiFilePlayer.setUseWebMIDI(true);
        } else {
          this.midiFilePlayer.setUseWebMIDI(false);
          lib._tp_set_synth_engine(value);
        }
        break;
      case 'soundfont':
        const url = `${SOUNDFONT_URL_PATH}/${value}`;
        ensureEmscFileWithUrl(lib, `${SOUNDFONT_MOUNTPOINT}/${value}`, url)
          .then(filename => this._loadSoundfont(filename));
        break;
      case 'reverb':
        value = parseFloat(value);
        lib._tp_set_reverb(value);
        break;
      case 'fluidpoly':
        value = parseInt(value, 10);
        lib._tp_set_polyphony(value);
        break;
      case 'opl3bank':
        value = parseInt(value, 10);
        lib._tp_set_bank(value);
        break;
      case 'autoengine':
        value = !!value;
        break;
      case 'mididevice':
        this.midiFilePlayer.setOutput(midiDevices[value]);
        break;
      case 'gmreset':
        this.midiFilePlayer.reset();
        break;
      default:
        console.warn('MIDIPlayer has no parameter with id "%s".', id);
    }
    this.params[id] = value;
  }

  _loadSoundfont(filename) {
    console.log('Loading soundfont...');
    this.muteAudioDuringCall(() => {
      const err = lib.ccall('tp_load_soundfont', 'number', ['string'], [filename]);
      if (err !== -1) console.log('Loaded soundfont.');
    });
  }
}
