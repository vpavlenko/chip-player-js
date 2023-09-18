import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ANALYSIS_STUB,
  Analysis,
  AnalysisBox,
  AnalysisGrid,
  Cursor,
  RESOLUTION_MS,
  advanceAnalysis,
  getNoteColor,
} from "./Analysis";
import {
  NES_APU_NOTE_ESTIMATIONS,
  PAUSE,
  nesApuNoteEstimation,
} from "./nesApuNoteEstimations";

type OscType = "pulse" | "triangle" | "noise";

function findNoteWithClosestPeriod(
  period: number,
  oscType: OscType,
): nesApuNoteEstimation {
  if (period === -1) {
    return PAUSE;
  }
  if (oscType === "noise") {
    const noise = period % 10;
    return {
      name: `${noise}_`, // pause
      midiNumber: noise + 90,
      frequency: 0,
      pianoNumber: null,
      apuIndex: null,
      pulsePeriod: null,
      pulseFrequency: null,
      pulseTuningError: null,
      trianglePeriod: null,
      triangleFrequency: null,
      triangleTuningError: null,
    };
  }
  let closestNote: nesApuNoteEstimation | null = null;
  let smallestDifference = Infinity;

  for (const note of NES_APU_NOTE_ESTIMATIONS) {
    const currentPeriod =
      oscType === "pulse"
        ? Number(note.pulsePeriod)
        : Number(note.trianglePeriod);
    if (currentPeriod == null) continue;

    const diff = Math.abs(period - currentPeriod);

    if (diff < smallestDifference) {
      smallestDifference = diff;
      closestNote = note;
    }
  }

  return closestNote!;
}

export type Note = {
  note: {
    midiNumber: number;
    name: string;
  };
  span: [number, number];
  chipState: any;
};

const calculateNotesFromPeriods = (periods, oscType) => {
  if (periods === undefined) return [];

  const notes: Note[] = [];
  let timeInSeconds = 0;
  const stepInSeconds = RESOLUTION_MS;

  for (const period of periods) {
    const newNoteEstimation = findNoteWithClosestPeriod(period, oscType);
    const lastNote = notes[notes.length - 1];
    if (
      notes.length === 0 ||
      lastNote.note.midiNumber !== newNoteEstimation.midiNumber
    ) {
      if (notes.length > 0) {
        lastNote.span[1] = timeInSeconds;
      }
      notes.push({
        note: {
          midiNumber: period === -1 ? -1 : newNoteEstimation.midiNumber,
          name: newNoteEstimation.name,
        },
        span: [timeInSeconds, 0],
        chipState: { period: period },
      });
    }

    timeInSeconds += stepInSeconds;
  }
  if (notes.length > 0) {
    notes[notes.length - 1].span[1] = timeInSeconds;
  }

  return notes.filter((note) => note.note.midiNumber !== -1);
};

export const secondsToX = (seconds) => seconds * 70;
// const PIANO_ROLL_HEIGHT = 600;
const isNoteCurrentlyPlayed = (note, positionMs) => {
  const positionSeconds = positionMs / 1000;
  return note.span[0] <= positionSeconds && positionSeconds <= note.span[1];
};

const getNoteRectangles = (
  notes: Note[],
  color: string,
  analysis: Analysis,
  midiNumberToY: (number: number) => number,
  noteHeight: number,
  handleNoteClick = (note: Note) => {},
) => {
  return notes.map((note) => {
    const top = midiNumberToY(note.note.midiNumber); // + { 'red': 1, 'green': -1, 'blue': 0, 'white': 0, 'black': 0 }[color];
    const left = secondsToX(note.span[0]);
    const colorOrGradient = getNoteColor(color, note.note.midiNumber, analysis);
    const noteName = (
      <div
        className="noteText"
        style={{
          position: "relative",
          top: color === "black" ? `"-${noteHeight}px` : "0px",
          left: "1px",
          fontSize: `${Math.min(noteHeight, 14)}px`,
          lineHeight: `${Math.min(noteHeight, 14)}px`,
          fontFamily: "Helvetica, sans-serif",
        }}
      >
        {note.note.name.slice(0, -1)}
      </div>
    );
    return (
      <div
        className={analysis.mode && "noteRectangleTonal"}
        style={{
          position: "absolute",
          height: `${noteHeight}px`,
          width: secondsToX(note.span[1]) - secondsToX(note.span[0]),
          color: color === "white" ? "black" : "white",
          top,
          left,
          pointerEvents: color === "white" ? "none" : "auto",
          cursor: "pointer",
          zIndex: 10,
          // ...(color === 'white' ? { backgroundColor: color } : colorOrGradient)
          // ...(color === 'white' ? getTransparencyGradient('white') : colorOrGradient)
          ...colorOrGradient,
        }}
        onClick={() => handleNoteClick(note)}
      >
        {color !== "white" && noteName}
      </div>
    );
  });
};

const findCurrentlyPlayedNotes = (notes, positionMs) => {
  const result = [];
  for (const note of notes) {
    if (isNoteCurrentlyPlayed(note, positionMs)) {
      result.push(note);
    }
  }
  return result;
};

const getMidiRange = (
  notes: Note[],
): { minMidiNumber: number; maxMidiNumber: number } => {
  let minMidiNumber = +Infinity;
  let maxMidiNumber = -Infinity;
  for (const note of notes) {
    const { midiNumber } = note.note;
    if (midiNumber < minMidiNumber) {
      minMidiNumber = midiNumber;
    }
    if (midiNumber > maxMidiNumber) {
      maxMidiNumber = midiNumber;
    }
  }
  return { minMidiNumber, maxMidiNumber };
};

const Chiptheory = ({
  chipStateDump,
  getCurrentPositionMs,
  savedAnalysis,
  saveAnalysis,
}) => {
  const [analysis, setAnalysis] = useState<Analysis>(ANALYSIS_STUB);

  useEffect(() => {
    // If chipStateDump changed, that means we're playing a new subtune, and a previous analysis isn't valid.
    if (savedAnalysis) {
      setAnalysis(savedAnalysis);
    } else {
      setAnalysis(ANALYSIS_STUB);
    }
  }, [savedAnalysis]);

  const analysisRef = useRef(analysis);
  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  // Without the ref magic, this will only capture the initial analysis.
  const handleNoteClick = (note) =>
    advanceAnalysis(note, analysisRef.current, saveAnalysis, setAnalysis);

  const notes = useMemo(() => {
    return {
      p1: calculateNotesFromPeriods(chipStateDump.p1, "pulse"),
      p2: calculateNotesFromPeriods(chipStateDump.p2, "pulse"),
      t: calculateNotesFromPeriods(chipStateDump.t, "triangle"),
      n: calculateNotesFromPeriods(chipStateDump.n, "noise"),
    };
  }, [chipStateDump]);

  const allNotes = useMemo(
    () => [...notes.t, ...notes.n, ...notes.p1, ...notes.p2],
    [chipStateDump],
  );

  const { minMidiNumber, maxMidiNumber } = useMemo(
    () => getMidiRange([...notes.t, ...notes.p1, ...notes.p2]),
    [notes],
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
    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  const noteHeight = divHeight / (maxMidiNumber - minMidiNumber + 7);
  const midiNumberToY = (midiNumber) =>
    divHeight - (midiNumber - minMidiNumber + 4) * noteHeight;

  const noteRectangles = useMemo(() => {
    return [
      ...getNoteRectangles(
        notes.p1,
        "red",
        analysis,
        midiNumberToY,
        noteHeight,
        handleNoteClick,
      ),
      ...getNoteRectangles(
        notes.p2,
        "green",
        analysis,
        midiNumberToY,
        noteHeight,
        handleNoteClick,
      ),
      ...getNoteRectangles(
        notes.t,
        "blue",
        analysis,
        midiNumberToY,
        noteHeight,
        handleNoteClick,
      ),
      ...getNoteRectangles(
        notes.n,
        "black",
        analysis,
        midiNumberToY,
        noteHeight,
        handleNoteClick,
      ),
    ];
  }, [notes, analysis, noteHeight]);

  const [positionMs, setPositionMs] = useState(0);
  const currentlyPlayedRectangles = getNoteRectangles(
    findCurrentlyPlayedNotes(allNotes, positionMs),
    "white",
    analysis,
    midiNumberToY,
    noteHeight,
  );

  useEffect(() => {
    let running = true;

    const animate = () => {
      if (!running) {
        return;
      }

      setPositionMs(getCurrentPositionMs() - 70); // A dirty hack, I don't know why it gets ahead of playback.
      requestAnimationFrame(animate);
    };

    animate();

    return () => {
      running = false;
    };
  }, []);

  const [selectedDownbeat, setSelectedDownbeat] = useState<number | null>(null);

  return (
    <div className="App-main-content-and-settings">
      <div
        style={{
          width: "96%",
          height: "96%",
          marginTop: "1em",
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
        >
          {noteRectangles}
          {currentlyPlayedRectangles}
          <Cursor style={{ left: secondsToX(positionMs / 1000) }} />
          <AnalysisGrid
            analysis={analysis}
            allNotes={allNotes}
            midiNumberToY={midiNumberToY}
            noteHeight={noteHeight}
            selectedDownbeat={selectedDownbeat}
            selectDownbeat={setSelectedDownbeat}
          />
        </div>
      </div>
      <AnalysisBox
        analysis={analysis}
        saveAnalysis={saveAnalysis}
        setAnalysis={setAnalysis}
        selectedDownbeat={selectedDownbeat}
        selectDownbeat={setSelectedDownbeat}
      />
    </div>
  );
};

export default Chiptheory;
