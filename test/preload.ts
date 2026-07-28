import { plugin } from "bun";

// The UI modules import their own stylesheets; the test runner only needs the JS.
plugin({
  name: "css-stub",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  },
});
