import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap/dist/js/bootstrap.min';
import './fonts/Rubik/static/Rubik-Bold.ttf';
import './fonts/Rubik/static/Rubik-Regular.ttf';
import React from 'react';
import ReactDOM from 'react-dom';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { SnackbarProvider } from 'notistack';
import { createTheme, ThemeProvider, styled } from '@mui/material/styles';
import Notifier from './containers/Notifier/Notifier';
import store, { persistor } from './store';
import './store.saga.runner';
import { CreateInterceptors } from './utils/requestInterceptor';
import theme from './themes';
import 'intro.js/introjs.css';
import App from './App.jsx';

// register request interceptors
const interceptors = CreateInterceptors.getInstance();
interceptors.registerInterceptors();

ReactDOM.render(
  <Provider store={store}>
    <PersistGate loading={null} persistor={persistor}>
      {/* uncomment the following line if maximum is required */}
      <SnackbarProvider maxSnack={8}>
        <ThemeProvider theme={theme}>
          <Notifier />
          <App />
        </ThemeProvider>
      </SnackbarProvider>
    </PersistGate>
  </Provider>,
  document.getElementById('app')
);
