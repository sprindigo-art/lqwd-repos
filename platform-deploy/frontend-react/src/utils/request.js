/* eslint-disable no-console */
function parseJSON(response) {
  if (response.status === 204 || response.status === 205) {
    return null;
  }
  return response.json();
}

async function streamResponse(response) {
  const reader = response.body.getReader();
  const { value, done } = await reader.read();

  if (done) {
    console.log('The stream was already closed!');
  } else {
    const v = String.fromCharCode(...value);
    return v;
  }

  return null;
}

function checkStatus(response) {
  if (response.status >= 200 && response.status < 300) {
    return response;
  }

  const error = new Error(response.statusText);
  error.response = response;
  throw error;
}

export const isValidUrl = urlString => {
  try {
    return Boolean(new URL(urlString));
  } catch (e) {
    return false;
  }
};

export default function request(url, options, stream, check = true) {
  if (!check) {
    return fetch(url, options).then(stream ? streamResponse : parseJSON);
  }

  return fetch(url, options)
    .then(checkStatus)
    .then(stream ? streamResponse : parseJSON);
}
