import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.min';
import '../src/app.css'
import React from 'react';
import { createTheme, ThemeProvider, styled } from '@mui/material/styles';
import theme from '../src/themes'

export const decorators = [
  (Story) => (
    <ThemeProvider theme={theme} > <Story /> </ThemeProvider>
  ),
];

export const parameters = {
  actions: { argTypesRegex: "^on[A-Z].*" },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
}