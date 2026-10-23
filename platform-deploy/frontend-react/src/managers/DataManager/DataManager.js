/* eslint-disable no-console */
import { persistor } from '../../store';

function compareVersions(version1, version2) {
  const v1 = version1.split('.');
  const v2 = version2.split('.');
  let longestLength = v1.length > v2.length ? v1.length : v2.length;
  // only major and minor
  longestLength = longestLength > 3 ? 3 : longestLength;

  for (let i = 0; i < longestLength; i += 1) {
    if (v1[i] !== v2[i]) {
      return v1 > v2 ? 1 : -1;
    }
  }
  return 0;
}

export const CheckDataVersionAndClearIfObsolete = () => {
  const dataVersion = window.localStorage.getItem('dataVersion');
  // if data even exist
  if (dataVersion) {
    console.log(`data version detected: ${dataVersion}`);
    const currentAppVersion = process.env.REACT_APP_VERSION;
    if (compareVersions(dataVersion, currentAppVersion) !== 0) {
      console.log(
        `version mismatch detected: data@${dataVersion} and app@${currentAppVersion}`
      );
      console.log(
        `clearing localstorage and setting data version application version: ${process.env.REACT_APP_VERSION}`
      );
      window.localStorage.clear();
      window.localStorage.setItem('dataVersion', process.env.REACT_APP_VERSION);
    }
  } else {
    console.log(
      `data version not detected. clearing localstorage and setting data version application version: ${process.env.REACT_APP_VERSION}`
    );
    window.localStorage.clear();
    window.localStorage.removeItem('persist:root');
    window.localStorage.setItem('dataVersion', process.env.REACT_APP_VERSION);
  }
};

export const ClearLocalStorageForced = async () => {
  console.log(
    `clearing localstorage and setting data version application version: ${process.env.REACT_APP_VERSION}`
  );
  window.localStorage.clear();
  window.localStorage.setItem('dataVersion', process.env.REACT_APP_VERSION);

  const dataVersion = window.localStorage.getItem('dataVersion');
  console.log(`data version detected: ${dataVersion}`);
};
