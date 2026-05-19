export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        risk: {
          safe: '#10b981',
          caution: '#f59e0b',
          warning: '#f97316',
          danger: '#ef4444',
        },
      },
    },
  },
};
