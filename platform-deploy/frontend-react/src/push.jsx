/* eslint-disable */
import Store from "./store";
import { getNodeList, getSharedNodeList } from "./managers/nodeManager/nodeActions";
import { serverConnectionStatusChanged } from "./containers/ServerConnectionBanner/ServerConnectionBannerActions";
import { tryLogout } from './containers/LoginPage/LoginPageActions';
import { refresh } from './utils/refresh';
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source';
import { access } from "@babel/core/lib/config/validation/option-assertions";
import Cookies from 'js-cookie'

let endpoint = process.env.REACT_APP_PUSH_SERVER_URL;

let isSourceRunning = false;
var timeoutHandle;
// var retryTimeoutHandle;


function handleConnection(response) {

    if (response.status == 401) {
        throw new Error("Unauthorized");
    }

    if (response.status >= 200 && response.status < 300) {
        return response;
    }

    throw new Error("InternalServerError");
}

function customPushServerFetch(url) {
    return fetch(url)
        .then(handleConnection)
}

const logoutUser = () => {
    console.log('logout method here');
    window.localStorage.removeItem('user');
    Store.dispatch(tryLogout())
};

function setCookie(accessToken) {
    if (accessToken == null) {
        accessToken = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
    }

    Cookies.set('userAuthCookie', accessToken)
}

export default async function connect() {
    if (isSourceRunning)
        return

    setCookie()

    isSourceRunning = true

    // await fetchEventSource(endpoint, {
    //
    //     openWhenHidden: true,
    //     fetch: customPushServerFetch,
    //
    //     onopen(response) {
    //
    //         if (response.ok && response.headers.get('content-type') === EventStreamContentType) {
    //             isSourceRunning = true
    //             return;
    //         } else if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    //             // client-side errors are usually non-retrievable:
    //             throw new Error("InternalServerError");
    //
    //         } else {
    //             throw new Error("RetryError");
    //         }
    //     },
    //     onmessage(msg) {
    //         isSourceRunning = true
    //         Store.dispatch(serverConnectionStatusChanged(true))
    //         window.clearTimeout(timeoutHandle);
    //         // window.clearTimeout(retryTimeoutHandle);
    //         // retryTimeoutHandle = window.setTimeout(function () {
    //         //     throw new Error("RetryError");
    //         // }, 30000);
    //         if (msg.event === 'push') {
    //             handlePush(msg.data)
    //         } else if (msg.event === 'goaway') {
    //             //close and reconnect
    //             throw new Error("Reconnect");
    //         } else if (msg.event === 'close') {
    //             //close
    //             throw new Error("InternalServerError");
    //         }
    //     },
    //     onclose() {
    //         // if the server closes the connection unexpectedly, retry:
    //         throw new Error("RetryError");
    //     },
    //     onerror(err) {
    //         console.log("Push error is :", err)
    //
    //         timeoutHandle = window.setTimeout(function () {
    //             Store.dispatch(serverConnectionStatusChanged(false))
    //         }, 5000);
    //         if (err.message == "InternalServerError") {
    //             isSourceRunning = false
    //             throw err; // rethrow to stop the operation
    //         } else if (err.message == "Unauthorized") {
    //             // refresh token
    //             refresh()
    //                 .then((res) => {
    //                     if (res.status == 200) {
    //                         window.localStorage.setItem('user',
    //                             JSON.stringify({
    //                                 ...(JSON.parse(window.localStorage.user)),
    //                                 object: res.object
    //                             }));
    //
    //                         let accessToken = JSON.parse(res.object).access_token
    //                         setCookie(accessToken)
    //
    //                     } else {
    //                         isSourceRunning = false
    //                         throw err;
    //                     }
    //                 }).catch(
    //                     () => logoutUser()
    //                 );
    //
    //         } else {
    //             // do nothing to automatically retry. You can also
    //             // return a specific retry interval here.
    //         }
    //     }
    // });


}

function handlePush(rawData) {
    //parse received message
    const notification = JSON.parse(rawData);

    console.log("New notification: ", notification)

    if (notification.messageType == "EVENT") {
        if (notification.eventType == "NODE_STATUS") {
            Store.dispatch(getNodeList())
            Store.dispatch(getSharedNodeList())
        }

    } else {
        console.log("Pop up: ", notification)
    }
}