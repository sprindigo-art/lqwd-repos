import request from './request';

const baseURL = process.env.REACT_APP_DLA_BASE_URL;

export const REFRESH_URL = `${baseURL}/login/token/refresh`;

export const refresh = () => {
  const refreshToken = JSON.parse(
    JSON.parse(window.localStorage.getItem('user')).object
  ).refresh_token;
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    // body: JSON.stringify({
    //   refreshToken,
    // }),
  };
  const url = `${REFRESH_URL}?refreshToken=${refreshToken}`;
  return request(url, options);
};
