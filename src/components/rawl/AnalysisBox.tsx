import * as React from "react";
import { useEffect, useState } from "react";
import Select from "react-select";
import { Analysis } from "./analysis";

const TAGS = ["no tags"];

const FORM_SECTIONS = ["intro", "verse", "chorus", "bridge", "outro", "solo"];

export const AnalysisBox: React.FC<{
  analysis: Analysis;
  commitAnalysisUpdate: (analysisUpdate: Partial<Analysis>) => void;
  previouslySelectedMeasure: number;
  selectedMeasure: number;
  selectMeasure: (measure: number | null) => void;
}> = React.memo(
  ({
    analysis,
    commitAnalysisUpdate,
    previouslySelectedMeasure,
    selectedMeasure,
    selectMeasure,
  }) => {
    const useInputField = (
      initialValue,
      analysisFieldName,
      label,
      width = "95%",
      createAnalysisUpdate = null,
    ) => {
      const [value, setValue] = useState(initialValue.toString());
      const [isSaved, setIsSaved] = useState(false);

      useEffect(() => {
        setValue(analysis[analysisFieldName] ?? initialValue.toString());
      }, [analysis[analysisFieldName]]); // TODO: doesn't work for formSection

      useEffect(() => {
        if (isSaved) {
          const timer = setTimeout(() => setIsSaved(false), 100);
          return () => clearTimeout(timer);
        }
      }, [isSaved]);

      const handleKeyDown = (e) => {
        if (e.key === "Enter") {
          commitAnalysisUpdate(
            createAnalysisUpdate
              ? createAnalysisUpdate(analysis, value)
              : {
                  [analysisFieldName]:
                    typeof initialValue === "number"
                      ? parseInt(value, 10)
                      : value,
                },
          );
          setIsSaved(true);
        }
      };

      return (
        <div key={`if_${analysisFieldName}`} style={{ marginTop: "10px" }}>
          {label}:{" "}
          <input
            type="text"
            value={value}
            style={{
              width,
              backgroundColor: isSaved ? "#66d" : "#aaa",
              transition: "background-color 0.1s",
            }}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
      );
    };

    const comment = useInputField("", "comment", "Comment");
    const formSection = useInputField(
      "",
      null,
      "Form section",
      undefined,
      (analysis, value) => {
        selectMeasure(null);
        return {
          form: { ...analysis.form, [selectedMeasure]: value },
        };
      },
    );

    return (
      <div className="App-main-content-area settings" key="AnalysisBox">
        <div key="menu" style={{ marginTop: "20px" }}>
          {selectedMeasure !== null ? (
            <div>
              <div>What to do with measure {selectedMeasure}?</div>
              <ul className="vertical-list-of-buttons">
                <li>Enter modulation: alt+click on a new tonic</li>
                <li>
                  {formSection}
                  <div>
                    {FORM_SECTIONS.map((formSection) => (
                      <button
                        style={{ marginRight: "10px", marginTop: "10px" }}
                        className="box-button"
                        onClick={() => {
                          selectMeasure(null);
                          commitAnalysisUpdate({
                            form: {
                              ...analysis.form,
                              [selectedMeasure]: formSection,
                            },
                          });
                        }}
                      >
                        {formSection}
                      </button>
                    ))}
                  </div>
                </li>
              </ul>
            </div>
          ) : (
            <div>
              {comment}
              <div key="tags" style={{ marginTop: "10px" }}>
                Tags:
                <Select
                  isMulti
                  options={TAGS.map((tag) => ({ value: tag, label: tag }))}
                  value={(analysis.tags || []).map((tag) => ({
                    value: tag,
                    label: tag,
                  }))}
                  onChange={(tags) => {
                    commitAnalysisUpdate({
                      tags: tags.map((tag) => tag.value),
                    });
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  },
);
