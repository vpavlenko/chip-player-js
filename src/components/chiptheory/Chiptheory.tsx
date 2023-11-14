import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisBox } from "./AnalysisBox";
import { BookExample } from "./Book";
import { InfiniteHorizontalScrollSystemLayout } from "./SystemLayout";
import {
  ANALYSIS_STUB,
  Analysis,
  advanceAnalysis,
  getNewAnalysis,
} from "./analysis";
import { calculateMeasuresAndBeats } from "./measures";
import { ChipStateDump, Note, parseNotes } from "./noteParsers";

export type Voice = "pulse1" | "pulse2" | "triangle" | "noise" | "under cursor";

// If not used, the playback cursor isn't exactly where the sound is
const LATENCY_CORRECTION_MS =
  (localStorage && parseInt(localStorage.getItem("latency"), 10)) || 70;

export type SecondsSpan = [number, number];

const SECOND_WIDTH = 60;
const HORIZONTAL_HEADER_PADDING = 55;
export const secondsToX = (seconds) =>
  seconds * SECOND_WIDTH + HORIZONTAL_HEADER_PADDING;
const xToSeconds = (x) => x / SECOND_WIDTH;

// For some reason I decided not to highlight currently played notes.
//
// const isNoteCurrentlyPlayed = (note, positionMs) => {
//   const positionSeconds = positionMs / 1000;
//   return note.span[0] <= positionSeconds && positionSeconds <= note.span[1];
// };
// const findCurrentlyPlayedNotes = (notes, positionMs) => {
//   const result = [];
//   for (const note of notes) {
//     if (isNoteCurrentlyPlayed(note, positionMs)) {
//       result.push(note);
//     }
//   }
//   return result;
// };

const Chiptheory: React.FC<{
  chipStateDump: ChipStateDump;
  getCurrentPositionMs: () => number;
  savedAnalysis: Analysis;
  saveAnalysis: (Analysis) => void;
  voiceMask: boolean[];
  setVoiceMask: (mask: boolean[]) => void;
  analysisEnabled: boolean;
  seek: (ms: number) => void;
  registerSeekCallback: (seekCallback: (ms: number) => void) => void;
  bookPath: string;
  pause: () => void;
  paused: boolean;
  loggedIn: boolean;
}> = ({
  chipStateDump,
  getCurrentPositionMs,
  savedAnalysis,
  saveAnalysis,
  voiceMask,
  setVoiceMask,
  analysisEnabled, // is it a reasonable argument?
  seek,
  registerSeekCallback,
  bookPath,
  pause,
  paused,
  loggedIn,
}) => {
  const [analysis, setAnalysis] = useState<Analysis>(ANALYSIS_STUB);
  const [showIntervals, setShowIntervals] = useState(false);
  const [playEnd, setPlayEnd] = useState(null);

  const commitAnalysisUpdate = useCallback(
    (analysisUpdate: Partial<Analysis>) => {
      const updatedAnalysis = { ...analysis, ...analysisUpdate };
      saveAnalysis(updatedAnalysis);
      setAnalysis(updatedAnalysis);
    },
    [analysis, saveAnalysis],
  );

  useEffect(() => {
    if (savedAnalysis) {
      setAnalysis(savedAnalysis);
    } else {
      setAnalysis(ANALYSIS_STUB);
    }
  }, [savedAnalysis]);

  const [previouslySelectedMeasure, setPreviouslySelectedMeasure] = useState<
    number | null
  >(null);
  const [selectedMeasure, setSelectedMeasure] = useState<number | null>(null);
  const selectMeasure = useCallback(
    (measure) => {
      if (measure === null) {
        setPreviouslySelectedMeasure(null);
        setSelectedMeasure(null);
      } else {
        setPreviouslySelectedMeasure(selectedMeasure);
        setSelectedMeasure(measure);
      }
    },
    [selectedMeasure],
  );

  const analysisRef = useRef(analysis);
  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  const selectedMeasureRef = useRef(selectedMeasure);
  useEffect(() => {
    selectedMeasureRef.current = selectedMeasure;
  }, [selectedMeasure]);

  const parsingResult = useMemo(
    () => parseNotes(chipStateDump),
    [chipStateDump],
  );
  const { notes } = parsingResult;

  const allNotes = useMemo(() => notes.flat(), [notes]);

  const allActiveNotes = useMemo(
    () => notes.filter((_, i) => voiceMask[i]).flat(),
    [notes, voiceMask],
  );

  const [hoveredNote, setHoveredNote] = useState<Note | null>(null);
  const [hoveredAltKey, setHoveredAltKey] = useState<boolean>(false);
  const handleMouseEnter = (note: Note, altKey: boolean) => {
    setHoveredNote(note);
    setHoveredAltKey(altKey);
  };
  const handleMouseLeave = () => {
    setHoveredNote(null);
  };

  const futureAnalysis = useMemo(
    () =>
      hoveredNote
        ? getNewAnalysis(
            hoveredNote,
            selectedMeasureRef.current,
            analysisRef.current,
            null,
            allNotes,
            parsingResult?.measuresAndBeats?.measures ??
              calculateMeasuresAndBeats(analysis, allNotes).measures,
            hoveredAltKey,
          )
        : analysis,
    [hoveredNote, analysis],
  );
  const measuresAndBeats = useMemo(() => {
    return (
      parsingResult?.measuresAndBeats ??
      calculateMeasuresAndBeats(futureAnalysis, allNotes)
    );
  }, [futureAnalysis, allNotes, parsingResult]);

  const handleNoteClick = (note: Note, altKey: boolean) => {
    advanceAnalysis(
      note,
      selectedMeasureRef.current,
      setSelectedMeasure,
      analysisRef.current,
      commitAnalysisUpdate,
      null,
      allNotes,
      measuresAndBeats.measures,
      altKey,
    );
  };

  const [positionMs, setPositionMs] = useState(0);
  // const currentlyPlayedRectangles = getNoteRectangles(
  //   findCurrentlyPlayedNotes(allNotes, positionMs),
  //   -1,
  //   true,
  //   analysis,
  //   midiNumberToY,
  //   noteHeight,
  // );

  useEffect(() => {
    let running = true;

    const animate = () => {
      if (!running) {
        return;
      }

      setPositionMs(getCurrentPositionMs() - LATENCY_CORRECTION_MS);
      requestAnimationFrame(animate);
    };

    animate();

    return () => {
      running = false;
    };
  }, []);

  useEffect(() => {
    const handleEscapePress = (event) => {
      if (event.key === "Escape" || event.keyCode === 27) {
        selectMeasure(null);
      }
    };

    document.addEventListener("keydown", handleEscapePress);

    return () => {
      document.removeEventListener("keydown", handleEscapePress);
    };
  }, []);

  // TODO: we should probably get rid of a tune timeline at some point.
  // MuseScore somehow doesn't have it?

  if (
    !paused &&
    bookPath &&
    analysis.loop &&
    (positionMs - 3000 > measuresAndBeats.measures[analysis.loop - 1] * 1000 ||
      (playEnd && positionMs > measuresAndBeats.measures[playEnd] * 1000))
  ) {
    pause();
  }

  // TODO: fix to scroll back to top for both layouts
  //
  // useEffect(() => {
  //   divRef.current.scrollLeft = 0;
  // }, [chipStateDump]);

  // TODO: useCallback
  const systemClickHandler = (e) => {
    const targetElement = e.target as HTMLElement;
    const rect = targetElement.getBoundingClientRect();
    const distance =
      e.clientX -
      rect.left +
      targetElement.scrollLeft -
      HORIZONTAL_HEADER_PADDING;
    const time = xToSeconds(distance);
    if (selectedMeasure) {
      advanceAnalysis(
        null,
        selectedMeasureRef.current,
        setSelectedMeasure,
        analysisRef.current,
        commitAnalysisUpdate,
        time,
      );
    } else {
      seek(time * 1000);
    }
  };

  return (
    <div className="App-main-content-and-settings">
      <InfiniteHorizontalScrollSystemLayout
        analysis={analysis}
        voiceMask={voiceMask}
        handleNoteClick={handleNoteClick}
        handleMouseEnter={handleMouseEnter}
        handleMouseLeave={handleMouseLeave}
        allActiveNotes={allActiveNotes}
        systemClickHandler={systemClickHandler}
        positionMs={positionMs}
        futureAnalysis={futureAnalysis}
        notes={notes}
        seek={seek}
        measuresAndBeats={measuresAndBeats}
        previouslySelectedMeasure={previouslySelectedMeasure}
        selectedMeasure={selectedMeasure}
        selectMeasure={selectMeasure}
        commitAnalysisUpdate={commitAnalysisUpdate}
        setVoiceMask={setVoiceMask}
        loggedIn={loggedIn}
        showIntervals={showIntervals}
        setShowIntervals={setShowIntervals}
        fileType={chipStateDump.type}
        registerSeekCallback={registerSeekCallback}
        hoveredNote={hoveredNote}
        hoveredAltKey={hoveredAltKey}
      />
      {analysisEnabled &&
        (bookPath ? (
          <BookExample
            path={bookPath}
            playSegment={(span, mask) => {
              const newVoiceMask = [...voiceMask];
              for (let i = 0; i < mask.length; ++i) {
                newVoiceMask[i] = mask[i] === "1";
              }
              setVoiceMask(newVoiceMask);
              setPlayEnd(span ? span[1] : null);
              const start = span
                ? measuresAndBeats.measures[span[0] - 1] * 1000
                : 0;
              seek(start);
              // TODO: enable it
              // seekCallback(start);
            }}
            analysis={analysis}
          />
        ) : (
          <AnalysisBox
            analysis={analysis}
            commitAnalysisUpdate={commitAnalysisUpdate}
            previouslySelectedMeasure={previouslySelectedMeasure}
            selectedMeasure={selectedMeasure}
            selectMeasure={selectMeasure}
          />
        ))}
      <div
        style={{
          position: "fixed",
          top: "50px",
          right: "20px",
          zIndex: "100",
        }}
      >
        <input
          title="Intervals"
          type="checkbox"
          onClick={(e) => {
            e.stopPropagation();
          }}
          onChange={(e) => {
            e.stopPropagation();
            setShowIntervals(e.target.checked);
          }}
          checked={showIntervals}
        />
        Intervals
      </div>
    </div>
  );
};

export default Chiptheory;
