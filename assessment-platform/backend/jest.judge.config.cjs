module.exports = {
  ...require('./jest.config.cjs'),
  roots: ['<rootDir>/test/judge'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 180000,
};
