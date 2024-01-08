import * as React from "react";
import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnalysisGrid, Cursor, MeasureSelection } from "./AnalysisGrid";
import { SecondsSpan, SetVoiceMask, secondsToX, xToSeconds } from "./Rawl";
import { Analysis, MeasuresSpan, PitchClass } from "./analysis";
import { TWELVE_TONE_COLORS } from "./colors";
import { Note, NotesInVoices } from "./parseMidi";

export type MeasuresAndBeats = {
  measures: number[];
  beats: number[];
};

const getPhrasingMeasures = (
  analysis: Analysis,
  numMeasures: number,
): number[] => {
  if ((analysis.fourMeasurePhrasingReferences?.length ?? 0) > 1) {
    return Array.from(
      new Set([
        ...analysis.fourMeasurePhrasingReferences,
        ...Object.keys(analysis.form || {}).map((key) => parseInt(key, 10)),
      ]),
    ).sort((a, b) => a - b);
  }
  const fourMeasurePhrasingStart =
    analysis.fourMeasurePhrasingReferences?.[0] ?? 1;
  const result = [];
  let i;
  for (i = fourMeasurePhrasingStart; i < numMeasures; i += 4) {
    result.push(i);
  }
  result.push(i);
  return result;
};

const STACKED_LAYOUT_NOTE_HEIGHT = 5;

export const getModulations = (analysis: Analysis) =>
  [
    { measure: -1, tonic: analysis.tonic },
    ...Object.entries(analysis.modulations || []).map((entry) => ({
      measure: parseInt(entry[0], 10) - 1,
      tonic: entry[1],
    })),
  ].sort((a, b) => a.measure - b.measure);

const getTonic = (measure: number, analysis: Analysis): PitchClass => {
  const modulations = getModulations(analysis);
  let i = 0;
  while (i + 1 < modulations.length && modulations[i + 1].measure <= measure) {
    i++;
  }
  return modulations[i].tonic as PitchClass;
};

const getNoteMeasure = (note: Note, measures: number[] | null): number => {
  if (!measures) {
    return -1;
  }
  const noteMiddle = (note.span[0] + note.span[1]) / 2;
  return measures.findIndex((time) => time >= noteMiddle) - 1;
};

const getAverageMidiNumber = (notes: Note[]) =>
  notes.length > 0
    ? notes[0].isDrum
      ? 0
      : notes.reduce((sum, note) => sum + note.note.midiNumber, 0) /
        notes.length
    : Infinity;

export type SystemLayout = "merged" | "split";

export type MidiRange = [number, number];

const GM_DRUM_KIT = {
  31: "🕒", //"Metronome Click",
  35: "🦵", //"Acoustic Bass Drum",
  36: "🦶🏼", //"Bass Drum 1",
  37: "🏑", //"Side Stick",
  38: "🥁", //"Acoustic Snare",
  39: "👏", //"Hand Clap",
  40: "⚡", //"Electric Snare",
  41: "0️⃣", //"Low Floor Tom",
  42: "🔒", // "Closed Hi Hat",
  43: "1️⃣", //"High Floor Tom",
  44: "🚴‍♀️", //"Pedal Hi-Hat",
  45: "2️⃣", //"Low Tom",
  46: "💿", //"Open Hi-Hat",
  47: "3️⃣", // "Low-Mid Tom",
  48: "4️⃣", //"Hi-Mid Tom",
  49: "💥", //"Crash Cymbal 1",
  50: "5️⃣", //"High Tom",
  51: "🚗", //"Ride Cymbal 1",
  52: "🇨🇳", //"Chinese Cymbal",
  53: "🛎️", //"Ride Bell",
  54: "🔔", //"Tambourine",
  55: "💦", //"Splash Cymbal",
  56: "🐄",
  57: "🔥", //"Crash Cymbal 2",
  58: "📳",
  59: "🚙", //"Ride Cymbal 2",
  60: "🔼",
  61: "🔽",
  62: "🕺",
  63: "💃",
  64: "🪘",
  65: "⬆️",
  66: "⬇️",
  67: "🗼",
  68: "🍦",
  69: "🍡",
  70: "🎉",
  71: "😗",
  72: "💨",
  73: "#️⃣",
  74: "📶",
  75: "🔑",
  76: "🪵",
  77: "🌳",
  78: "🐭",
  79: "🇧🇷",
  80: "⨻",
  81: "△",
  82: "⚱️", //'Shaker',
  83: "🎅🏻", //"Jingle Bell",
  84: "🚿",
  85: "🌰",
  86: "🍺",
  87: "🛢️",
};

const getMidiRange = (notes: Note[], span?: SecondsSpan): MidiRange => {
  let min = +Infinity;
  let max = -Infinity;
  for (const note of notes) {
    if (span && (note.span[1] < span[0] || note.span[0] > span[1])) {
      continue;
    }
    const { midiNumber } = note.note;
    min = Math.min(min, midiNumber);
    max = Math.max(max, midiNumber);
  }
  return [min, max];
};

const getMidiRangeWithMask = (
  notes: NotesInVoices,
  voiceMask: boolean[],
  span?: SecondsSpan,
): MidiRange => {
  let min = +Infinity;
  let max = -Infinity;
  for (let voice = 0; voice < notes.length; ++voice) {
    if (!voiceMask[voice]) {
      continue;
    }
    const voiceSpan = getMidiRange(notes[voice], span);
    min = Math.min(min, voiceSpan[0]);
    max = Math.max(max, voiceSpan[1]);
  }
  return [min, max];
};

// This is used when tonic isn't set yet.
// TODO: introduce 16 colors for all possible midi channels
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
    return VOICE_TO_COLOR[voiceIndex % VOICE_TO_COLOR.length];
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

export type MouseHandlers = {
  handleNoteClick: (note: Note, altKey: boolean) => void;
  handleMouseEnter: (note: Note, altKey: boolean) => void;
  handleMouseLeave: () => void;
  hoveredNote: Note | null;
  hoveredAltKey: boolean;
  systemClickHandler: (e: React.MouseEvent, time?: number) => void;
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
  showVelocity = false,
  offsetSeconds: number,
) => {
  return notes.map((note) => {
    const top = midiNumberToY(note.note.midiNumber);
    const left = secondsToX(note.span[0] - offsetSeconds);
    const color = note.isDrum
      ? "white"
      : getNoteColor(voiceIndex, note, analysis, measures);
    const chordNote = note.isDrum
      ? GM_DRUM_KIT[note.note.midiNumber] || note.note.midiNumber
      : null;
    // TODO: make it only for isDrum
    const noteElement = chordNote ? (
      <span
        className="noteText"
        style={{
          fontSize: note.isDrum ? "10px" : `${Math.min(noteHeight + 2, 14)}px`,
          position: "relative",
          left: note.isDrum ? "-5px" : "0px",
          lineHeight: `${Math.min(noteHeight, 14)}px`,
          fontFamily: "Helvetica, sans-serif",
          fontWeight: note.isDrum ? 100 : 700,
          color: "white",
        }}
      >
        {chordNote}
      </span>
    ) : null;
    return (
      <div
        key={`nr_${note.id}`}
        className={"noteRectangleTonal"}
        style={{
          position: "absolute",
          height: `${noteHeight}px`,
          width: note.isDrum
            ? "0px"
            : secondsToX(note.span[1]) - secondsToX(note.span[0]),
          backgroundColor: color,
          overflow: "visible",
          top,
          left,
          pointerEvents: voiceIndex === -1 ? "none" : "auto",
          borderRadius: note.isDrum
            ? 0
            : [10, 3, 0, 5, 20, 7, 1][voiceIndex % 7],
          // borderBottom: note.isDrum ? "1px solid white" : "",
          cursor: "pointer",
          zIndex: 10,
          //   opacity: isActiveVoice ? 0.9 : 0.1,
          // TODO: make it map onto the dynamic range of a song? of a track?
          opacity: isActiveVoice
            ? (showVelocity && note?.chipState?.on?.param2 / 127) || 1
            : 0.1,
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
        {noteElement}
      </div>
    );
  });
};

// TODO: add types
// TODO: maybe add React.memo
export const MergedSystemLayout = ({
  voiceMask,
  allActiveNotes,
  positionSeconds,
  futureAnalysis,
  notes,
  measuresAndBeats,
  measureSelection,
  showVelocity,
  registerSeekCallback,
  mouseHandlers,
}) => {
  const {
    handleNoteClick,
    handleMouseEnter,
    handleMouseLeave,
    hoveredNote,
    hoveredAltKey,
    systemClickHandler,
  } = mouseHandlers;

  // TODO: should probably use just "notes" instead, since stretched notes look ugly.
  const midiRange = useMemo(
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

  useEffect(() => {
    registerSeekCallback(
      (seekMs) => (divRef.current.scrollLeft = secondsToX(seekMs / 1000) - 100),
    );
  }, []);

  const noteHeight = divHeight / (midiRange[1] - midiRange[0] + 7);
  const midiNumberToY = useMemo(
    () => (midiNumber) =>
      divHeight - (midiNumber - midiRange[0] + 4) * noteHeight,
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
          showVelocity,
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
      showVelocity,
    ],
  );
  const phraseStarts = useMemo(
    () => getPhrasingMeasures(futureAnalysis, measuresAndBeats.measures.length),
    [futureAnalysis, measuresAndBeats],
  );

  return (
    <div
      key="innerLeftPanel"
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
      <Cursor style={{ left: secondsToX(positionSeconds) }} />
      <AnalysisGrid
        analysis={futureAnalysis}
        measuresAndBeats={measuresAndBeats}
        midiNumberToY={midiNumberToY}
        noteHeight={noteHeight}
        measureSelection={measureSelection}
        firstMeasureNumber={1}
        secondsToX={secondsToX}
        phraseStarts={phraseStarts}
        systemLayout={"merged"}
        midiRange={midiRange}
      />
    </div>
  );
};

const isInSecondsSpan = (time: number, span: SecondsSpan) =>
  span[0] <= time && time <= span[1];

const VoiceName: React.FC<{
  voiceName: string;
  voiceMask: boolean[];
  setVoiceMask: SetVoiceMask;
  voiceIndex: number;
}> = React.memo(({ voiceName, voiceMask, setVoiceMask, voiceIndex }) => {
  return (
    <>
      {voiceName}{" "}
      <span
        style={{
          cursor: "pointer",
          userSelect: "none",
          fontFamily: "sans-serif",
          fontSize: 12,
        }}
        onClick={() =>
          voiceMask.filter((voice) => voice).length === 1
            ? setVoiceMask(voiceMask.map(() => true))
            : setVoiceMask(voiceMask.map((_, i) => i === voiceIndex))
        }
      >
        S
      </span>{" "}
      <span
        style={{
          cursor: "pointer",
          userSelect: "none",
          fontFamily: "sans-serif",
          fontSize: 12,
        }}
        onClick={() =>
          setVoiceMask(
            voiceMask.map((value, i) => (i !== voiceIndex ? value : false)),
          )
        }
      >
        M
      </span>{" "}
    </>
  );
});

const Phrase: React.FC<
  DataForPhrase & {
    analysis: Analysis;
    showVelocity: boolean;
    globalMeasures: number[];
    cursor?: ReactNode;
    phraseStarts: number[];
    mouseHandlers: MouseHandlers;
    measureSelection: MeasureSelection;
    showHeader?: boolean;
    scrollLeft?: number;
    scrollRight?: number;
    voiceName?: string;
    voiceMask: boolean[];
    setVoiceMask?: SetVoiceMask;
    voiceIndex?: number;
    bigVoiceMask: boolean[];
  }
> = ({
  notes,
  measuresAndBeats,
  measuresSpan,
  secondsSpan,
  voiceMask,
  analysis,
  globalMeasures,
  mouseHandlers,
  measureSelection,
  showVelocity,
  cursor,
  phraseStarts,
  showHeader = true,
  scrollLeft = -1,
  scrollRight = -1,
  voiceName,
  voiceIndex = -1,
  setVoiceMask = (mask) => {},
  bigVoiceMask,
}) => {
  const midiRange = useMemo(
    () =>
      getMidiRangeWithMask(notes, voiceMask, [
        xToSeconds(scrollLeft),
        xToSeconds(scrollRight),
      ]),
    [notes, voiceMask, scrollLeft, scrollRight],
  );

  const {
    handleNoteClick,
    handleMouseEnter,
    handleMouseLeave,
    hoveredNote,
    hoveredAltKey,
    systemClickHandler,
  } = mouseHandlers;

  const height =
    (midiRange[0] === +Infinity ? 1 : midiRange[1] - midiRange[0] + 1) *
      STACKED_LAYOUT_NOTE_HEIGHT +
    (showHeader ? 15 : 0);

  const midiNumberToY = useCallback(
    (midiNumber) =>
      height - (midiNumber - midiRange[0] + 1) * STACKED_LAYOUT_NOTE_HEIGHT,
    [height, midiRange],
  );

  const mySecondsToX = useCallback(
    (seconds) => secondsToX(seconds - secondsSpan[0]),
    [secondsSpan[0]],
  );

  const { noteRectangles, frozenHeight, frozenMidiRange } = useMemo(
    () => ({
      noteRectangles: notes.flatMap((notesInOneVoice, voice) =>
        getNoteRectangles(
          notesInOneVoice,
          voice,
          true,
          analysis,
          midiNumberToY,
          STACKED_LAYOUT_NOTE_HEIGHT,
          () => {},
          globalMeasures,
          () => {},
          () => {},
          [],
          showVelocity,
          secondsSpan[0],
        ),
      ),
      frozenHeight: height,
      frozenMidiRange: midiRange,
    }),
    [
      notes,
      analysis,
      globalMeasures,
      //   hoveredNote,
      //   hoveredAltKey,
      showVelocity,
    ],
  );

  const hasVisibleNotes = midiRange[1] > midiRange[0];

  return (
    <div
      key={`outer_phrase_${measuresSpan[0]}`}
      style={{
        width: mySecondsToX(
          measuresAndBeats.measures[measuresAndBeats.measures.length - 1],
        ),
        height: hasVisibleNotes ? height : 1,
        position: "relative",
        marginTop: hasVisibleNotes ? "10px" : 0,
        marginBottom: hasVisibleNotes ? "20px" : 0,
        borderBottom: hasVisibleNotes ? "1px solid #888" : "",
      }}
      onClick={(e) => systemClickHandler(e, secondsSpan[0])}
    >
      <div
        style={{
          position: "relative",
          top:
            height -
            frozenHeight +
            (midiRange[0] - frozenMidiRange[0]) * STACKED_LAYOUT_NOTE_HEIGHT,
        }}
      >
        {noteRectangles}
      </div>
      {hasVisibleNotes ? (
        <AnalysisGrid
          analysis={analysis}
          measuresAndBeats={measuresAndBeats}
          midiNumberToY={midiNumberToY}
          noteHeight={STACKED_LAYOUT_NOTE_HEIGHT}
          measureSelection={measureSelection}
          firstMeasureNumber={measuresSpan[0]}
          phraseStarts={phraseStarts}
          secondsToX={mySecondsToX}
          systemLayout={"split"}
          midiRange={midiRange}
          showHeader={showHeader}
          showTonalGrid={!notes?.[0]?.[0].isDrum}
        />
      ) : null}
      {cursor}
      {hasVisibleNotes ? (
        <div
          style={{
            position: "relative",
            left: scrollLeft + 10,
            top: -16,
            zIndex: 2,
            fontFamily: "sans-serif",
            fontSize: "12px",
          }}
        >
          <VoiceName
            voiceName={voiceName}
            voiceMask={bigVoiceMask}
            setVoiceMask={setVoiceMask}
            voiceIndex={voiceIndex}
          />
        </div>
      ) : null}
    </div>
  );
};

// TODO: if it's too slow, we can split notes into phrases more efficiently using linear scans.
// I'm just too lazy to implement it now.
const getNotesBetweenTimestamps = (
  notes: NotesInVoices,
  secondsSpan: SecondsSpan,
): NotesInVoices =>
  notes.map((notesInOneVoice) =>
    notesInOneVoice.filter((note) =>
      isInSecondsSpan((note.span[0] + note.span[1]) / 2, secondsSpan),
    ),
  );

type DataForPhrase = {
  notes: NotesInVoices;
  measuresAndBeats: MeasuresAndBeats;
  measuresSpan: MeasuresSpan;
  secondsSpan: SecondsSpan;
};

const SPLIT_VOICE_MASK = [true];

const debounce = (func, delay) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
};

export const SplitSystemLayout: React.FC<{
  notes: NotesInVoices;
  voiceNames: string[];
  voiceMask: boolean[];
  measuresAndBeats: MeasuresAndBeats;
  showVelocity: boolean;
  positionSeconds: number;
  analysis: Analysis;
  mouseHandlers: MouseHandlers;
  measureSelection: MeasureSelection;
  setVoiceMask: SetVoiceMask;
}> = ({
  notes,
  voiceNames,
  voiceMask,
  measuresAndBeats,
  showVelocity,
  positionSeconds,
  analysis,
  mouseHandlers,
  measureSelection,
  setVoiceMask,
}) => {
  const voicesSortedByAverageMidiNumber = useMemo(
    () =>
      notes
        .map((voice, voiceIndex) => ({
          average: getAverageMidiNumber(voice),
          voiceIndex,
        }))
        .sort((a, b) => b.average - a.average)
        .map(({ voiceIndex }) => ({
          voiceIndex,
          notes: [notes[voiceIndex]],
        })),
    [notes],
  );

  const phraseStarts = useMemo(
    () => getPhrasingMeasures(analysis, measuresAndBeats.measures.length),
    [analysis, measuresAndBeats],
  );

  // If scroll changed and debounced, we need to calculate which voices have
  // any visible notes and hides those who don't.

  const parentRef = useRef(null);

  const [scrollInfo, setScrollInfo] = useState({ left: 0, right: 100000 });

  const debouncedScroll = useCallback(
    debounce(
      (left, right) =>
        setScrollInfo({
          left,
          right,
        }),
      100,
    ),
    [],
  );

  const handleScroll = () => {
    const { scrollLeft, offsetWidth } = parentRef.current;
    const scrollRight = scrollLeft + offsetWidth;

    debouncedScroll(scrollLeft, scrollRight);
  };

  useEffect(() => {
    const parentDiv = parentRef.current;
    if (parentDiv) {
      parentDiv.addEventListener("scroll", handleScroll);
    }

    return () => {
      if (parentDiv) {
        parentDiv.removeEventListener("scroll", handleScroll);
      }
    };
  }, []);

  return (
    <div
      key="innerLeftPanel"
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
      ref={parentRef}
    >
      <div>
        {voicesSortedByAverageMidiNumber.map(({ voiceIndex, notes }, order) =>
          voiceMask[voiceIndex] ? (
            <Phrase
              key={voiceIndex}
              voiceName={voiceNames[voiceIndex]}
              notes={notes}
              // this is legacy for Stacked
              voiceMask={SPLIT_VOICE_MASK}
              measuresAndBeats={measuresAndBeats}
              measuresSpan={[1, measuresAndBeats.measures.length]}
              secondsSpan={[
                0,
                measuresAndBeats.measures[measuresAndBeats.measures.length - 1],
              ]}
              analysis={analysis}
              globalMeasures={measuresAndBeats.measures}
              mouseHandlers={mouseHandlers}
              measureSelection={measureSelection}
              showVelocity={showVelocity}
              showHeader={order === voicesSortedByAverageMidiNumber.length - 1}
              cursor={<Cursor style={{ left: secondsToX(positionSeconds) }} />}
              phraseStarts={phraseStarts}
              scrollLeft={scrollInfo.left}
              scrollRight={scrollInfo.right}
              bigVoiceMask={voiceMask}
              setVoiceMask={setVoiceMask}
              voiceIndex={voiceIndex}
            />
          ) : null,
        )}
      </div>
    </div>
  );
};
