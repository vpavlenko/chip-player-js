import * as React from "react";
import { Link } from "react-router-dom";

const AppHeader: React.FC = () => {
  return (
    <header className="AppHeader">
      <Link className="AppHeader-title" to={{ pathname: "/" }}>
        Rawl
      </Link>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <a href="https://github.com/vpavlenko/rawl" target="_blank">
        <div className="octocat" />
      </a>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <a href="https://vpavlenko.github.io/layouts">Layouts</a>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <a href="/s/">Structures</a>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <a href="/corpus/">Corpus</a>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <a href="/timeline/">Timeline</a>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <a href="/old/">Old</a>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <a href="https://github.com/vpavlenko/study-music">Books</a>
    </header>
  );
};

export default AppHeader;
