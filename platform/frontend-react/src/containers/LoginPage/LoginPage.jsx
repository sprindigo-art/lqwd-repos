/* eslint-disable */
import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useSelector, useDispatch } from 'react-redux';
import { loggedIn, tryLoginMfa } from "./LoginPageActions";
import { useAuth } from "../../hooks/useAuth";
import { useNavigate, useLocation } from 'react-router-dom';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { CheckDataVersionAndClearIfObsolete, ClearLocalStorageForced } from "../../managers/DataManager/DataManager";
import './LoginPage.css';
import LoginLayout from "../../layouts/LoginLayout/LoginLayout";
import LoginForm from "../../components/LoginComponent/LoginForm/LoginForm";
import ConfirmMfa from "../../components/LoginComponent/ConfirmMfa/ConfirmMfa";
import { Modal } from "react-bootstrap";
import { requestGetLatestAppVersion, requestLogin } from "../../requests/Login";
import { useSnackbar } from "notistack";
import LoginLayoutMobile from "../../layouts/LoginLayout/LoginLayoutMobile";
import LoginFormMobile from "../../components/LoginComponent/LoginForm/LoginFormMobile";

import NotificationDuration from 'NotificationDuration';
import { USER_LOGOUT } from "../App/AppConstants";
const queryString = require('query-string');

const LoginPage = () => {

    const user = useSelector(state => state.userReducer);
    const verifyState = useSelector(state => state.verifyReducer);

    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    const navigate = useNavigate();

    const { login } = useAuth();

    const dispatch = useDispatch();
    const [userInfo, setUserInfo] = useState({});
    const [showMfaModal, setShowMfaModal] = useState(false);


    const onLoginClick = (data) => {
        setUserInfo({
            username: data.username,
            password: data.password
        });
        requestLogin(data)
            .then(function (response) {
                if (response.status != 200) {
                    enqueueSnackbar(response.error, { variant: 'error', autoHideDuration: NotificationDuration });
                } else {
                    setUserInfo({
                        username: data.username,
                        password: data.password
                    });

                    if (response.status === 200) {
                        setShowMfaModal(true);

                    } else {
                        let error = JSON.parse(response.error);
                        enqueueSnackbar(error.error_description, { variant: 'error', autoHideDuration: NotificationDuration });
                    }
                }

            })
            .catch(function (error) {
                enqueueSnackbar(error, { variant: 'error', autoHideDuration: NotificationDuration });
            });
    }

    const handleMfaActivate = (value) => {
        dispatch(tryLoginMfa(userInfo.username, userInfo.password, value));
    };

    if (user.error) {
        enqueueSnackbar(user.errmsg, { variant: 'error', autoHideDuration: NotificationDuration });
    }

    if (user.pending == true && user.loading == false && user.user
        && verifyState.userVerified == null && !verifyState.loading) {
        login(user.user);
    }

    if (user.pending == true && user.loading == false && user.user && verifyState.userVerified != null) {
        if (verifyState.userVerified) {
            login(user.user);
            const location = useLocation();
            const { redirectTo } = queryString.parse(location.search);
            navigate(redirectTo == null ? "/" : redirectTo);
        } else {
            navigate("/verify-email");
        }
    }

    if (user.pending == true && user.loading == false && !user.error && verifyState.userVerified != null) {
        if (verifyState.userVerified) {
            dispatch(loggedIn());
        } else {
            navigate("/verify-email");
        }
    }

    const [width, setWidth] = useState(window.innerWidth);

    function handleWindowSizeChange() {
        setWidth(window.innerWidth);
    }

    const isMobile = width <= 768;

    // Similar to componentDidMount and componentDidUpdate:
    useEffect(() => {
        // Update the document title using the browser API
        document.title = `LQWD | Login`;
        dispatch({type: USER_LOGOUT});
        //for local storage clean
        ClearLocalStorageForced();

        //update data version
        CheckDataVersionAndClearIfObsolete();

        //update application version
        requestGetLatestAppVersion()
            .then(function (response) {
                console.log(response);
                if (response.version) {
                    let version = response.version;
                    console.log(`version of server application is ${version}`)

                    const currentAppVersion = process.env.REACT_APP_VERSION;
                    if (version !== currentAppVersion) {
                        console.log(`version of server application is ${version} which is different from cached version of app ${currentAppVersion}. reloading to get latest files...`)
                        setTimeout(function () { window.location.reload(true); }, 500)
                    }
                }
            }).catch(function (error) {
                console.log(error);
            });

        window.addEventListener('resize', handleWindowSizeChange);
        return () => {
            window.removeEventListener('resize', handleWindowSizeChange);
        }
    }, []);

    const LoginPageForm = () => {

        return (
            <>
                <LoginForm onLoginClick={onLoginClick}></LoginForm>
                <Modal className='' centered show={showMfaModal} onHide={() => setShowMfaModal(false)} backdrop='static' keyboard="False" >
                    <Modal.Body className='px-4'>
                        <ConfirmMfa show={showMfaModal} onActivate={handleMfaActivate} goBack={() => setShowMfaModal(false)} onClose={() => setShowMfaModal(false)}></ConfirmMfa>
                    </Modal.Body>
                </Modal>
            </>
        );
    }

    const LoginPageFormMobile = () => {
        return (
            <>
                <LoginFormMobile onLoginClick={onLoginClick}></LoginFormMobile>
                <ConfirmMfa show={showMfaModal} onActivate={handleMfaActivate} goBack={() => setShowMfaModal(false)} onClose={() => setShowMfaModal(false)} mobile={true}></ConfirmMfa>
            </>
        );
    }

    return (
        <>
            {isMobile ?
                <LoginLayoutMobile children={LoginPageFormMobile()}></LoginLayoutMobile>
                :
                <LoginLayout children={LoginPageForm()}></LoginLayout>
            }
        </>
    );
};

LoginPage.propTypes = {
    title: PropTypes.string,
};

export default LoginPage;