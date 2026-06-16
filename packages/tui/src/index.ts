import React from "react";
import { render } from "ink";
import { App, type AppProps } from "./app.js";

export function startTui(props: AppProps): void {
  render(React.createElement(App, props));
}

export { App, type AppProps } from "./app.js";
