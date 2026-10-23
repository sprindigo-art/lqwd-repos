// themeDecorator.js
import React from "react"
import { createTheme, ThemeProvider, styled } from '@mui/material/styles';
import theme from '../themes'

const ThemeDecorator = storyFn => (
    <ThemeProvider theme={theme} > {storyFn()} </ThemeProvider>
)

export default ThemeDecorator