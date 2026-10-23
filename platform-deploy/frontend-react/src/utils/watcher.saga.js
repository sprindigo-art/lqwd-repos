/* eslint-disable */
import { select, put, takeEvery } from 'redux-saga/effects';
import { tryLogout } from '../containers/LoginPage/LoginPageActions';

export default function* watchAndLog() {
    yield takeEvery('*', function* logger(action) {
        const state = yield select();
        if (window.localStorage.getItem('debug')) {
            console.log('action', action);
            console.log('state after', state);
        }

        // ------------- example fo using actions based on event  -------------
        // if (action.type.startsWith("LQWD/DLA/API_RESPONSE")) {
        //     if (action.payload.error.response.status == 401) {
        //         console.log('action', action);
        //         console.log('state after', state);
        //         window.localStorage.setItem('user', null);
        //         yield put(tryLogout());
        //     }
        // }
    });
}