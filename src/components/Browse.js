import React, { useEffect } from "react";
import BrowseList from "./BrowseList";

const Browse = ({
  browsePath,
  listing,
  fetchDirectory,
  playContext,
  currIdx,
  handleSongClick,
  analyses,
  searchPath,
}) => {
  useEffect(() => {
    const fetchData = () => {
      if (!listing) {
        fetchDirectory(browsePath);
      }
    };
    fetchData();
  }, [browsePath, listing, fetchDirectory]);

  const searchParams = new URLSearchParams(window.location.search);

  return (
    <div
      style={{
        height:
          searchParams.get("song") ||
          searchParams.get("link") ||
          browsePath.startsWith("f/")
            ? "0px"
            : "100%",
        overflow: "scroll",
        margin: 0,
      }}
    >
      <BrowseList
        browsePath={browsePath}
        playContext={playContext}
        items={listing || []}
        currIdx={currIdx}
        handleSongClick={handleSongClick}
        analyses={analyses}
        searchPath={searchPath}
      />
    </div>
  );
};

export default Browse;
