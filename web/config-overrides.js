const CopyPlugin = require("copy-webpack-plugin")

module.exports = function override(config, env) {
  // ...
  config.plugins.push(
    // ...
    new CopyPlugin({
      patterns: [
        // ...
        {
          from: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
          to: "static/js/[name][ext]",
        },
        {
          from: "node_modules/@ricky0123/vad-web/dist/*.onnx",
          to: "static/js/[name][ext]",
        },
        { from: "node_modules/onnxruntime-web/dist/*.wasm", to: "static/js/[name][ext]" },
      ],
    }),
  )
  return config;
}

