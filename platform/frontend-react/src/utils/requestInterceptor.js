/* eslint-disable */
import fetchIntercept from 'fetch-intercept';
import { refresh, REFRESH_URL } from './refresh';
import Store from '../store'
import { tryLogout } from '../containers/LoginPage/LoginPageActions';
import request, { isValidUrl } from "../utils/request";

let pushserverURL = process.env.REACT_APP_PUSH_SERVER_URL;
let ignoredEndpoints = [pushserverURL, "https://blockchain.info/ticker"]
if (!isValidUrl(pushserverURL)) {
    //path relative to current origin
    ignoredEndpoints.push(window.location.origin + pushserverURL);
}


export const CreateInterceptors = (() => {
    let instance;

    const init = () => {
        let isRefreshing = false;
        let refreshSubscribers = [];
        let dataRequests = {};

        const logoutUser = () => {
            console.log('logout method here');
            window.localStorage.removeItem('user');
            Store.dispatch(tryLogout())
        };

        const subscribeTokenRefresh = callback => {
            refreshSubscribers.push(callback);
        };

        const onRefreshed = () => {
            refreshSubscribers.map(callback => callback());
            refreshSubscribers = [];
        };

        const removeDataRequestsItem = requestKey => {
            const {
                [requestKey]: _omit, ...remaining
            } = dataRequests;
            dataRequests = remaining;
        };

        const getRelativeUrl = url => url.replace(window.location.origin, '');

        return {
            registerInterceptors: () => {
                fetchIntercept.register({
                    request(url, config) {

                        if (ignoredEndpoints.includes(url)) {
                            return [url, config];
                        }

                        if ((config && url.indexOf(REFRESH_URL) === -1)) {
                            dataRequests = {
                                ...dataRequests,
                                [`${getRelativeUrl(url)}_${config.method || 'GET'}`]: config,
                            };
                            let userObject = JSON.parse(window.localStorage.getItem('user'));
                            if (userObject && config.headers.Authorization) {
                                let newToken = JSON.parse(JSON.parse(window.localStorage.getItem('user')).object).access_token;
                                config.headers.Authorization = `Bearer ${newToken}`;
                            }

                        }
                        return [url, config];
                    },

                    response(response) {
                        const requestKey = `${getRelativeUrl(response.url)}_${response.request.method}`;

                        if (ignoredEndpoints.includes(response.url)) {
                            return response
                        }

                        if (
                            response.status === 401 &&
                            response.url.indexOf(REFRESH_URL) === -1
                        ) {
                            console.log('retrying later')
                            if (!isRefreshing) {
                                console.log('refreshing token')
                                isRefreshing = true;
                                refresh()
                                    .then((res) => {
                                        if (res.status == 200) {
                                            window.localStorage.setItem('user', JSON.stringify({...(JSON.parse(window.localStorage.user)), object: res.object }));

                                            isRefreshing = false;
                                            onRefreshed();
                                        } else {
                                            isRefreshing = false;
                                            const error = new Error(res.status);
                                            throw error;
                                        }
                                    })
                                    .catch(
                                        () => logoutUser()
                                    );
                            }
                            const retryOrigReq = new Promise((resolve, reject) => {
                                subscribeTokenRefresh(() => {
                                    fetch(response.url, {
                                            ...dataRequests[requestKey]
                                        })
                                        .then(origReqResponse => {
                                            resolve(origReqResponse);
                                            removeDataRequestsItem(requestKey);
                                        })
                                        .catch(err => {
                                            reject(err);
                                        });
                                });
                            });
                            return retryOrigReq;
                        }
                        removeDataRequestsItem(requestKey);
                        return response;
                    },
                });
            },
        };
    };

    return {
        getInstance() {
            if (!instance) {
                instance = init();
            }
            return instance;
        },
    };
})();