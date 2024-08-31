import React, { useCallback, useContext, useState } from "react";
import styled from "styled-components";
import { AppContext } from "../../AppContext";
import ErrorBoundary from "../../ErrorBoundary";
import { Analysis, Snippet } from "../analysis";
import SnippetList from "../SnippetList";

const PathContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow-y: auto;
`;

const ChapterRow = styled.div`
  display: flex;
  overflow-x: auto;
  background-color: #1a1a1a;
  position: sticky;
  top: 0;
  z-index: 1;
`;

const ChapterButton = styled.button<{ active: boolean }>`
  padding: 10px 20px;
  text-align: center;
  background-color: ${(props) => (props.active ? "#4a90e2" : "transparent")};
  color: white;
  border: none;
  cursor: pointer;
  white-space: nowrap;
`;

const ContentArea = styled.div`
  flex-grow: 1;
  background-color: #333333;
  padding: 10px;
`;

const ChapterSection = styled.div`
  margin-bottom: 20px;
`;

const TopicCard = styled.div`
  background-color: #000000;
  margin: 5px 0;
  padding: 10px;
  border-radius: 5px;
`;

const TopicTitle = styled.h3`
  font-size: 18px;
  margin: 0 0 10px 0;
  color: #ffffff;
`;

const ErrorMessage = styled.div`
  color: red;
  margin-bottom: 10px;
`;

const MidiButton = styled.button`
  display: block;
  padding: 3px 0;
  font-size: 14px;
  color: #ffffff;
  text-decoration: none;
  word-wrap: break-word;
  padding-left: 1em;
  text-indent: -1em;
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  &:hover {
    color: #4a90e2;
  }
`;

interface NewPathViewProps {
  analyses: { [key: string]: Analysis };
}

interface ChapterData {
  chapter: string;
  topics: {
    topic: string;
    snippets: Snippet[];
    midis: string[];
  }[];
}

const NewPathView: React.FC<NewPathViewProps> = ({ analyses }) => {
  const { handleSongClick } = useContext(AppContext);
  const [loading, setLoading] = useState(true);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [chapterData, setChapterData] = useState<ChapterData[]>([]);
  const [activeChapter, setActiveChapter] = useState(0);

  const processAnalyses = useCallback(() => {
    console.log("Processing analyses");
    const data: { [chapter: string]: ChapterData } = {};
    const errors: string[] = [];

    Object.entries(analyses).forEach(([path, analysis]) => {
      if (analysis.snippets && analysis.snippets.length > 0) {
        analysis.snippets.forEach((snippet) => {
          const [chapter, topic] = snippet.tag.split(":");
          if (!chapter || !topic) {
            errors.push(`Invalid tag format: ${snippet.tag}`);
            return;
          }

          if (!data[chapter]) {
            data[chapter] = { chapter, topics: [] };
          }

          let topicData = data[chapter].topics.find((t) => t.topic === topic);
          if (!topicData) {
            topicData = { topic, snippets: [], midis: [] };
            data[chapter].topics.push(topicData);
          }

          topicData.snippets.push(snippet);
          if (!topicData.midis.includes(path)) {
            topicData.midis.push(path);
          }
        });
      }
    });

    console.log("Processed data:", data);
    console.log("Errors:", errors);

    setErrorMessages(errors);
    setChapterData(
      Object.values(data).sort((a, b) => a.chapter.localeCompare(b.chapter)),
    );
    setLoading(false);
  }, [analyses]);

  React.useEffect(() => {
    processAnalyses();
  }, [processAnalyses]);

  const handleChapterSelect = (index: number) => {
    setActiveChapter(index);
  };

  const handleMidiClick = (slug: string) => {
    console.log("handleMidiClick called with slug:", slug);
    handleSongClick(`f:${slug}`);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (chapterData.length === 0) {
    return <div>No analyses with snippets found.</div>;
  }

  return (
    <ErrorBoundary>
      <PathContainer>
        <ChapterRow>
          {chapterData.map((chapter, index) => (
            <ChapterButton
              key={chapter.chapter}
              active={index === activeChapter}
              onClick={() => handleChapterSelect(index)}
              onMouseEnter={() => handleChapterSelect(index)}
            >
              {chapter.chapter}
            </ChapterButton>
          ))}
        </ChapterRow>
        <ContentArea>
          {errorMessages.map((error, index) => (
            <ErrorMessage key={index}>{error}</ErrorMessage>
          ))}
          <ChapterSection>
            <h2>{chapterData[activeChapter].chapter}</h2>
            {chapterData[activeChapter].topics.map((topic) => (
              <TopicCard key={topic.topic}>
                <TopicTitle>{topic.topic}</TopicTitle>
                <p>Number of snippets: {topic.snippets.length}</p>
                <SnippetList
                  snippets={topic.snippets}
                  measureWidth={50}
                  noteHeight={3}
                />
                <div>
                  {topic.midis.map((midi, index) => (
                    <MidiButton
                      key={index}
                      onClick={() => handleMidiClick(midi)}
                    >
                      {midi.replace(/---/g, " – ").replace(/-/g, " ")}
                    </MidiButton>
                  ))}
                </div>
              </TopicCard>
            ))}
          </ChapterSection>
        </ContentArea>
      </PathContainer>
    </ErrorBoundary>
  );
};

export default NewPathView;
