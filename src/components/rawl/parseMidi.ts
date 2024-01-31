import MIDIEvents from "midievents";
import { SecondsSpan } from "./Rawl";
import { MeasuresAndBeats } from "./SystemLayout";
const MIDIEvents = require("midievents");

const DRUM_CHANNEL = 9;

export type Note = {
  note: {
    midiNumber: number;
    relativeNumber?: number;
  };
  isDrum: boolean;
  id: number;
  span: SecondsSpan;
  chipState: { on: any; off: any };
};

export type PitchBendPoint = {
  time: number;
  value: number;
};

export type NotesInVoices = Note[][];

export type MidiSource = {
  events: any;
  activeChannels: any;
  timebase: any;
  timeEvents: any;
};

export type ParsingResult = {
  notes: NotesInVoices;
  measuresAndBeats?: MeasuresAndBeats;
};

let id = 0;

const getNotes = (events, channel): Note[] => {
  const notes: Note[] = [];
  const noteOn = {};
  events.forEach((event) => {
    if (event.channel === channel && event.type === MIDIEvents.EVENT_MIDI) {
      const midiNumber = event.param1;
      if (event.subtype === MIDIEvents.EVENT_MIDI_NOTE_OFF) {
        if (channel === DRUM_CHANNEL && midiNumber > 87) {
          return;
          // probably a bug? can't be played by a default MIDI sound font
        }
        if (midiNumber in noteOn) {
          if (channel !== DRUM_CHANNEL && noteOn[midiNumber].param2 === 0) {
            return;
          }
          if (event.playTime >= noteOn[midiNumber].playTime) {
            notes.push({
              note: {
                midiNumber,
              },
              id,
              isDrum: channel === DRUM_CHANNEL,
              span: [noteOn[midiNumber].playTime / 1000, event.playTime / 1000],
              chipState: { on: noteOn[midiNumber], off: event },
            });

            id++;
          }
          delete noteOn[midiNumber];
        }
      }
      if (event.subtype === MIDIEvents.EVENT_MIDI_PITCH_BEND) {
        // TODO: Process pitch bend range change messages.
        // https://chat.openai.com/share/8332f454-6d52-4911-a40c-f11c251fea1b
        for (const midiNumber in noteOn) {
          (noteOn[midiNumber].pitchBend ||= []).push({
            time: event.playTime / 1000,
            value: (event.param2 << 7) + event.param1,
          });
        }
      }
      if (event.subtype === MIDIEvents.EVENT_MIDI_NOTE_ON) {
        noteOn[midiNumber] = event;
      }
    }
  });
  if (channel === DRUM_CHANNEL) {
    const uniqueMidiNumbers = [
      ...new Set(notes.map((note) => note.note.midiNumber)),
    ].sort((a, b) => a - b);

    const midiToRelativeNumberMap = new Map();
    uniqueMidiNumbers.forEach((midiNumber, index) => {
      midiToRelativeNumberMap.set(midiNumber, index * 2);
    });

    notes.forEach((note) => {
      note.note.relativeNumber = midiToRelativeNumberMap.get(
        note.note.midiNumber,
      );
    });
  }
  return notes;
};

// We can also find key events:
// key: 0,
// scale: 0,
// subtype: 89,
// type: 255,
// Except that in practice these events are always key=0 scale=0 (no one is setting them)
// Although classical music MIDI might have it.

function calculateMeasureAndBeats(timeEvents) {
  const measures = [0];
  const beats = [];
  let secondsPerQuarterNote = 0.5;
  let numerator = 4;
  let denominator = 4;
  let lastBeatFractionGone = 0;
  let constructedBeatsInLastMeasure = 0;
  let lastBeatTime = 0; // either measures[-1] or beats[-1]

  const createNewBeat = (timeUntil) => {
    const newBeatEndTime =
      lastBeatTime +
      (1 - lastBeatFractionGone) * ((secondsPerQuarterNote / denominator) * 4);
    if (newBeatEndTime - 0.005 <= timeUntil) {
      if (constructedBeatsInLastMeasure + 1 >= numerator) {
        measures.push(newBeatEndTime);
        constructedBeatsInLastMeasure = 0;
      } else {
        beats.push(newBeatEndTime);
        constructedBeatsInLastMeasure++;
      }
      lastBeatFractionGone = 0;
      lastBeatTime = newBeatEndTime;
      return true;
    } else {
      lastBeatFractionGone +=
        (timeUntil - lastBeatTime) / secondsPerQuarterNote;
      lastBeatTime = timeUntil;
      return false;
    }
  };

  timeEvents.forEach((event) => {
    const { bpm, playTime } = event;
    while (createNewBeat(playTime / 1000));

    if (event.type === "timeSignature") {
      numerator = event.numerator;
      denominator = 2 ** event.denominatorPower;
    } else {
      secondsPerQuarterNote = 60 / bpm;
    }
  });

  return { measures, beats };
}

export const parseNotes = ({
  events,
  activeChannels,
  timeEvents,
}: MidiSource): ParsingResult => {
  const measuresAndBeats = calculateMeasureAndBeats(timeEvents);
  events.forEach((event) => {
    if (event.subtype === MIDIEvents.EVENT_META_KEY_SIGNATURE) {
      console.log("KEY SIGNATURE" + JSON.stringify(event));
    }
  });
  const notes = activeChannels.map((channel) => getNotes(events, channel));
  return {
    measuresAndBeats,
    notes,
  };
};
