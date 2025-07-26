module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    '@babel/preset-typescript',
  ],
  plugins: [
    // Add any necessary Babel plugins here
    // For example, if you're using decorators or other experimental features
  ],
  // Enable source maps for better test error messages
  sourceMaps: 'inline',
  // Ensure that the TypeScript preset processes .ts and .tsx files
  extensions: ['.ts', '.tsx', '.js', '.jsx'],
  // Configure how modules are transformed
  env: {
    test: {
      // Additional test-specific configurations can go here
    },
  },
};
