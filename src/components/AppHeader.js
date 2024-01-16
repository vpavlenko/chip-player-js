import React from "react";
import { Link } from "react-router-dom";

export default class AppHeader extends React.PureComponent {
  render() {
    return (
      <header className="AppHeader">
        <Link className="AppHeader-title" to={{ pathname: "/" }}>
          Rawl
        </Link>
        {" • "}
        <Link className="AppHeader-title" to={{ pathname: "/axes" }}>
          Axes
        </Link>
        {" • "}
        <Link className="AppHeader-title" to={{ pathname: "/intro" }}>
          Intro
        </Link>
        {" • "}
        <Link className="AppHeader-title" to={{ pathname: "/course" }}>
          Course
        </Link>
        {/* {" • "}
        <Link
          className="AppHeader-title"
          to={{ pathname: "/browse/Classical%20MIDI" }}
        >
          Classical
        </Link> */}
        {" • "}
        Built on top of{" "}
        <a
          href="https://chiptune.app/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Chip Player JS
        </a>
        {this.props.user ? (
          <>
            {" • "}
            Logged in as {this.props.user.displayName}.{" "}
            <a href="#" onClick={this.props.handleLogout}>
              Logout
            </a>
          </>
        ) : (
          <>
            <a href="#" onClick={this.props.handleLogin}>
              {"."}
            </a>{" "}
          </>
        )}
      </header>
    );
  }
}
