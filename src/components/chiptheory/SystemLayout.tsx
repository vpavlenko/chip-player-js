import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisGrid, Cursor, MeasureSelection } from "./AnalysisGrid";
import { SecondsSpan, secondsToX } from "./Chiptheory";
import { Analysis, MeasuresSpan } from "./analysis";
import { MeasuresAndBeats, getPhrasingMeasures } from "./measures";
import { Note, NotesInVoices } from "./noteParsers";
import {
  TWELVE_CHORD_TONES,
  TWELVE_TONE_COLORS,
  getChordNote,
  getNoteMeasure,
  getTonic,
} from "./romanNumerals";
import { ANALYSIS_HEIGHT } from "./tags";

const STACKED_LAYOUT_NOTE_HEIGHT = 10;
const STACKED_LAYOUT_HEADER_HEIGHT = 50;

const getMidiRange = (
  notes: Note[],
): { minMidiNumber: number; maxMidiNumber: number } => {
  let minMidiNumber = +Infinity;
  let maxMidiNumber = -Infinity;
  for (const note of notes) {
    const { midiNumber } = note.note;
    minMidiNumber = Math.min(minMidiNumber, midiNumber);
    maxMidiNumber = Math.max(maxMidiNumber, midiNumber);
  }
  return { minMidiNumber, maxMidiNumber };
};

const getMidiRangeWithMask = (notes: NotesInVoices, voiceMask: boolean[]) => {
  let globalMinMidiNumber = +Infinity;
  let globalMaxMidiNumber = -Infinity;
  for (let voice = 0; voice < notes.length; ++voice) {
    if (!voiceMask[voice]) {
      continue;
    }
    const { minMidiNumber, maxMidiNumber } = getMidiRange(notes[voice]);
    globalMinMidiNumber = Math.min(globalMinMidiNumber, minMidiNumber);
    globalMaxMidiNumber = Math.max(globalMaxMidiNumber, maxMidiNumber);
  }
  return {
    minMidiNumber: globalMinMidiNumber,
    maxMidiNumber: globalMaxMidiNumber,
  };
};

// This is used when tonic isn't set yet.
const VOICE_TO_COLOR = [
  "#26577C",
  "#AE445A",
  "#63995a",
  "#7c7126",
  "#7c2676",
  "#4e267c",
];

const getNoteColor = (
  voiceIndex: number,
  note: Note,
  analysis,
  measures: number[],
): string => {
  if (analysis.tonic === null) {
    return VOICE_TO_COLOR[voiceIndex % VOICE_TO_COLOR.length]; // TODO: introduce 16 colors for all possible midi channels
  }

  return TWELVE_TONE_COLORS[
    (note.note.midiNumber -
      getTonic(getNoteMeasure(note, measures), analysis)) %
      12
  ];
};

const isCenterInsideSpan = (note: Note, span: SecondsSpan) => {
  let center = (note.span[0] + note.span[1]) / 2;
  return span[0] < center && center < span[1];
};

const getIntervalBelow = (note: Note, allNotes: Note[]) => {
  let minDistance = Infinity;
  for (let n of allNotes) {
    if (
      n.note.midiNumber < note.note.midiNumber &&
      isCenterInsideSpan(note, n.span)
    ) {
      minDistance = Math.min(
        minDistance,
        note.note.midiNumber - n.note.midiNumber,
      );
    }
  }
  return minDistance;
};

export type NoteMouseHandlers = {
  handleNoteClick: (note: Note, altKey: boolean) => void;
  handleMouseEnter: (note: Note, altKey: boolean) => void;
  handleMouseLeave: () => void;
  hoveredNote: Note | null;
  hoveredAltKey: boolean;
};

const getNoteRectangles = (
  notes: Note[],
  voiceIndex: number, // -1 if it's a note highlight for notes under cursor. currently can't happen
  isActiveVoice: boolean,
  analysis: Analysis,
  midiNumberToY: (number: number) => number,
  noteHeight: number,
  handleNoteClick = (note: Note, altKey: boolean) => {},
  measures: number[] = null,
  handleMouseEnter = (note: Note, altKey: boolean) => {},
  handleMouseLeave = () => {},
  allNotes: Note[] = [],
  showIntervals = false,
  offsetSeconds: number,
) => {
  return notes.map((note) => {
    const top = midiNumberToY(note.note.midiNumber);
    const left = secondsToX(note.span[0] - offsetSeconds);
    const color = getNoteColor(voiceIndex, note, analysis, measures);
    const chordNote =
      voiceIndex !== -1
        ? getChordNote(note, analysis, measures, analysis.romanNumerals)
        : null;
    const noteElement = chordNote ? (
      <span
        className="noteText"
        style={{
          fontSize: `${Math.min(noteHeight + 2, 14)}px`,
          lineHeight: `${Math.min(noteHeight, 14)}px`,
          fontFamily: "Helvetica, sans-serif",
          fontWeight: 700,
          color:
            ["brown", "blue", "#9400D3", "#787276"].indexOf(color) !== -1
              ? "white"
              : "black",
        }}
      >
        {chordNote}
      </span>
    ) : null;
    const intervalBelow = showIntervals && getIntervalBelow(note, allNotes);

    return (
      <div
        className={"noteRectangleTonal"}
        style={{
          position: "absolute",
          height: `${noteHeight}px`,
          width: secondsToX(note.span[1]) - secondsToX(note.span[0]),
          backgroundColor: color,
          top,
          left,
          pointerEvents: voiceIndex === -1 ? "none" : "auto",
          borderRadius: [10, 3, 0, 5, 20, 7, 1][voiceIndex % 7],
          cursor: "pointer",
          zIndex: 10,
          opacity: isActiveVoice ? 0.9 : 0.1,
          display: "grid",
          placeItems: "center",
          ...(voiceIndex === -1
            ? {
                boxShadow: "white 0px 1px",
                boxSizing: "border-box",
                backgroundColor: "transparent",
              }
            : {}),
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleNoteClick(note, e.altKey);
        }}
        onMouseEnter={(e) => handleMouseEnter(note, e.altKey)}
        onMouseLeave={handleMouseLeave}
      >
        {showIntervals && intervalBelow !== Infinity && isActiveVoice && (
          // voiceMask.filter(Boolean).length === 1 &&
          <div
            style={{
              position: "relative",
              top: noteHeight,
              color: "white",
              fontFamily: "sans-serif",
              fontSize: "12px",
            }}
          >
            {TWELVE_CHORD_TONES[intervalBelow % 12]}
          </div>
        )}
        {!showIntervals && noteElement}
      </div>
    );
  });
};

// TODO: add types
// TODO: maybe add React.memo
export const InfiniteHorizontalScrollSystemLayout = ({
  voiceMask,
  handleNoteClick,
  handleMouseEnter,
  handleMouseLeave,
  allActiveNotes,
  systemClickHandler,
  positionMs,
  futureAnalysis,
  notes,
  measuresAndBeats,
  previouslySelectedMeasure,
  selectedMeasure,
  selectMeasure,
  showIntervals,
  registerSeekCallback,
  hoveredNote,
  hoveredAltKey,
  stripeSpecificProps,
}) => {
  const { minMidiNumber, maxMidiNumber } = useMemo(
    () => getMidiRange(allActiveNotes.flat()),
    [allActiveNotes],
  );

  const [divHeight, setDivHeight] = useState(0);
  const divRef = useRef(null);
  useEffect(() => {
    const updateHeight = () => {
      if (divRef.current) {
        setDivHeight(divRef.current.offsetHeight);
      }
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    new ResizeObserver(() => updateHeight()).observe(divRef.current);
    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  const seekCallback = (seekMs) =>
    (divRef.current.scrollLeft = secondsToX(seekMs / 1000) - 100);

  useEffect(() => {
    registerSeekCallback(seekCallback);
  }, []);

  const noteHeight =
    (divHeight - ANALYSIS_HEIGHT) / (maxMidiNumber - minMidiNumber + 7);
  const midiNumberToY = useMemo(
    () => (midiNumber) =>
      divHeight - (midiNumber - minMidiNumber + 4) * noteHeight,
    [noteHeight],
  );

  const noteRectangles = useMemo(
    () =>
      notes.flatMap((voice, i) =>
        getNoteRectangles(
          voice,
          i,
          voiceMask[i],
          futureAnalysis,
          midiNumberToY,
          noteHeight,
          handleNoteClick,
          measuresAndBeats.measures,
          handleMouseEnter,
          handleMouseLeave,
          allActiveNotes,
          showIntervals,
          0,
        ),
      ),
    [
      notes,
      futureAnalysis,
      measuresAndBeats,
      noteHeight,
      voiceMask,
      hoveredNote,
      hoveredAltKey,
      showIntervals,
    ],
  );

  return (
    <div
      key="leftPanel"
      style={{
        width: "100%",
        height: "100%",
        padding: 0,
        backgroundColor: "black",
      }}
    >
      <div
        ref={divRef}
        style={{
          margin: 0,
          padding: 0,
          position: "relative",
          overflowX: "scroll",
          overflowY: "hidden",
          width: "100%",
          height: "100%",
          backgroundColor: "black",
        }}
        onClick={systemClickHandler}
      >
        {noteRectangles}
        <Cursor style={{ left: secondsToX(positionMs / 1000) }} />
        <AnalysisGrid
          analysis={futureAnalysis}
          measuresAndBeats={measuresAndBeats}
          midiNumberToY={midiNumberToY}
          noteHeight={noteHeight}
          previouslySelectedMeasure={previouslySelectedMeasure}
          selectedMeasure={selectedMeasure}
          selectMeasure={selectMeasure}
          stripeSpecificProps={stripeSpecificProps}
          firstMeasureNumber={1}
          secondsToX={secondsToX}
        />
      </div>
    </div>
  );
};

const Phrase: React.FC<
  DataForPhrase & {
    voiceMask: boolean[];
    analysis: Analysis;
    showIntervals: boolean;
    globalMeasures: number[];
  } & NoteMouseHandlers &
    MeasureSelection
> = ({
  notes,
  measuresAndBeats,
  measuresSpan,
  voiceMask,
  analysis,
  globalMeasures,
  handleNoteClick,
  handleMouseEnter,
  handleMouseLeave,
  hoveredNote,
  hoveredAltKey,
  previouslySelectedMeasure,
  selectedMeasure,
  selectMeasure,
  showIntervals,
}) => {
  // Can I just use an <InfiniteScroll/>
  // I should have a fixed noteHeight

  // calculate midiRange

  // showAnalysisGrid

  const { minMidiNumber, maxMidiNumber } = getMidiRangeWithMask(
    notes,
    voiceMask,
  );

  if (minMidiNumber === +Infinity) {
    return (
      <div>
        no notes in mm. {measuresSpan[0]}-{measuresSpan[1]}
      </div>
    );
  }

  const height =
    (maxMidiNumber - minMidiNumber + 1) * STACKED_LAYOUT_NOTE_HEIGHT +
    STACKED_LAYOUT_HEADER_HEIGHT;

  const midiNumberToY = (midiNumber) =>
    height - (midiNumber - minMidiNumber + 1) * STACKED_LAYOUT_NOTE_HEIGHT;

  const noteRectangles = useMemo(
    () =>
      notes.flatMap((notesInOneVoice, voice) =>
        getNoteRectangles(
          notesInOneVoice,
          voice,
          voiceMask[voice],
          analysis,
          midiNumberToY,
          STACKED_LAYOUT_NOTE_HEIGHT,
          handleNoteClick,
          globalMeasures,
          handleMouseEnter,
          handleMouseLeave,
          [], // TODO: pass allActiveNotes in this phrase to enable showIntervals view
          showIntervals,
          globalMeasures[measuresSpan[0] - 1],
        ),
      ),
    [
      notes,
      analysis,
      globalMeasures,
      voiceMask,
      hoveredNote,
      hoveredAltKey,
      showIntervals,
    ],
  );

  return (
    <div>
      <div style={{ width: "100%", height, position: "relative" }}>
        {noteRectangles}
        <AnalysisGrid
          analysis={analysis}
          measuresAndBeats={measuresAndBeats}
          midiNumberToY={midiNumberToY}
          noteHeight={STACKED_LAYOUT_NOTE_HEIGHT}
          previouslySelectedMeasure={previouslySelectedMeasure}
          selectedMeasure={selectedMeasure}
          selectMeasure={selectMeasure}
          firstMeasureNumber={measuresSpan[0]}
          secondsToX={(seconds) =>
            secondsToX(seconds - globalMeasures[measuresSpan[0] - 1])
          }
        />
      </div>
    </div>
  );
};

// TODO: if it's too slow, we can split notes into phrases more efficiently using linear scans.
// I'm just too lazy to implement it now.
const getNotesBetweenTimestamps = (
  notes: NotesInVoices,
  secondFrom: number,
  secondTo: number,
): NotesInVoices =>
  notes.map((notesInOneVoice) =>
    notesInOneVoice.filter((note) => {
      const middle = (note.span[0] + note.span[1]) / 2;
      return secondFrom <= middle && middle < secondTo;
    }),
  );

type DataForPhrase = {
  notes: NotesInVoices;
  measuresAndBeats: MeasuresAndBeats;
  measuresSpan: MeasuresSpan;
};

const calculateDataForPhrases = (
  notes: NotesInVoices,
  measuresAndBeats: MeasuresAndBeats,
  phraseStarts: number[],
): DataForPhrase[] => {
  const { measures, beats } = measuresAndBeats;
  const data = [];
  for (let i = 0; i < phraseStarts.length - 1; ++i) {
    const measuresSpan = [phraseStarts[i], phraseStarts[i + 1]];
    data.push({
      notes: getNotesBetweenTimestamps(
        notes,
        measures[measuresSpan[0] - 1],
        measures[measuresSpan[1] - 1],
      ),
      measuresSpan,
      measuresAndBeats: {
        measures: measures.filter(
          (measure) =>
            measures[measuresSpan[0] - 1] <= measure &&
            measure < measures[measuresSpan[1] - 1],
        ),
        beats: beats.filter(
          (beat) =>
            measures[measuresSpan[0] - 1] <= beat &&
            beat < measures[measuresSpan[1] - 1],
        ),
      },
    });
  }
  return data;
};

// TODO: memo everything
export const StackedSystemLayout: React.FC<
  {
    analysis: Analysis;
    futureAnalysis: Analysis;
    measuresAndBeats: MeasuresAndBeats;
    notes: NotesInVoices;
    voiceMask: boolean[];
    showIntervals: boolean;
  } & NoteMouseHandlers &
    MeasureSelection
> = ({
  analysis,
  futureAnalysis,
  measuresAndBeats,
  notes,
  voiceMask,
  handleNoteClick,
  handleMouseEnter,
  handleMouseLeave,
  hoveredNote,
  hoveredAltKey,
  previouslySelectedMeasure,
  selectedMeasure,
  selectMeasure,
  showIntervals,
}) => {
  // splitMeasuresIntoPhrases
  // splitNotesIntoPhrases

  // we can make a very easy manual implementation: first 8 measures go to first phrase, everything else goes to the next measure

  // let's skip all notes that are in muted voices
  // what's the efficient way to put all notes into phrase buckets?

  const phraseStarts = getPhrasingMeasures(
    analysis,
    measuresAndBeats.measures.length,
  );
  // TODO: support loops
  const dataForPhrases = useMemo(
    () => calculateDataForPhrases(notes, measuresAndBeats, phraseStarts),
    [notes, measuresAndBeats, phraseStarts],
  );

  return (
    <div
      key="leftPanel"
      style={{
        width: "100%",
        height: "100%",
        padding: 0,
        backgroundColor: "black",
      }}
    >
      <div
        // TODO: implement divRef
        style={{
          margin: 0,
          padding: 0,
          position: "relative",
          overflowX: "scroll",
          overflowY: "scroll",
          width: "100%",
          height: "100%",
          backgroundColor: "black",
        }}
        // TODO: implement seek
        // onClick={systemClickHandler}
      >
        {dataForPhrases.map((data) => (
          <Phrase
            {...data}
            analysis={futureAnalysis}
            voiceMask={voiceMask}
            globalMeasures={measuresAndBeats.measures}
            handleNoteClick={handleNoteClick}
            handleMouseEnter={handleMouseEnter}
            handleMouseLeave={handleMouseLeave}
            hoveredNote={hoveredNote}
            hoveredAltKey={hoveredAltKey}
            previouslySelectedMeasure={previouslySelectedMeasure}
            selectedMeasure={selectedMeasure}
            selectMeasure={selectMeasure}
            showIntervals={showIntervals}
          />
        ))}
      </div>
    </div>
  );
};
