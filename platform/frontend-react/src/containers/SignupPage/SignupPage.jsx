/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './SignupPage.css';
import LoginLayout from "../../layouts/LoginLayout/LoginLayout";
import { useDispatch, useSelector } from "react-redux";
import { getCurrentNumberRegistered, signupLoggedIn, signupPageLogin } from "./SignupPageActions";
import Mfa from "../../components/LoginComponent/Mfa/Mfa";
import BetaSignupForm from "../../components/Signup/BetaSignupForm";
import { requestSignup } from "../../requests/Signup";
import { useSnackbar } from "notistack";
import LoginLayoutMobile from "../../layouts/LoginLayout/LoginLayoutMobile";
import BetaSignupFormMobile from "../../components/Signup/BetaSignupFormMobile";
import { useLocation, useNavigate } from "react-router-dom";
import queryString from "query-string";
import { useAuth } from "../../hooks/useAuth";
import NotificationDuration from 'NotificationDuration';

const SignupPage = () => {

  const signupPageState = useSelector(state => state.signupPageReducer);
  const verifyState = useSelector(state => state.verifyReducer);

  const dispatch = useDispatch()

  const { login } = useAuth();
  const navigate = useNavigate();
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();
  const [showMfa, setShowMfa] = useState(false);
  const [userName, setUserName] = useState('');
  const [pass, setPass] = useState('');
  const [mfaValues, setMfaValues] = useState({});
  // Similar to componentDidMount and componentDidUpdate:

  //create user
  const handleSignUp = (username, password) => {
    console.log(username, password);
    setUserName(username);
    setPass(password);

    // wait for signup confirm
    requestSignup({ username, password })
      .then(function (response) {
        if (JSON.parse(response).status === 200){
          setMfaValues({
            mfaValue: JSON.parse(JSON.parse(response).object).mfaSecret,
            mfaUrl: JSON.parse(JSON.parse(response).object).mfaUrl
          });
          setShowMfa(true);
        }else {
          let error = JSON.parse(JSON.parse(response).error);
          console.log(error);
          enqueueSnackbar(error.message, { variant: 'error', autoHideDuration: NotificationDuration });
        }
      })
      .catch(function(error) {
        console.log(error);
        enqueueSnackbar("Failed to Register User, Please Try Again Later.", { variant: 'error', autoHideDuration: NotificationDuration });
      });
  };

  //validate
  const validateMfaLogin = (value) => {
    console.log(userName, pass, value);
    dispatch(signupPageLogin(userName, pass, value));
  }


  const [width, setWidth] = useState(window.innerWidth);

  function handleWindowSizeChange() {
    setWidth(window.innerWidth);
  }

  const isMobile = width <= 768;

  if (signupPageState.pending == true && signupPageState.loading == false && signupPageState.user) {
    console.log(signupPageState);
    if(verifyState.userVerified){
      login(signupPageState.user);
      const location = useLocation();
      const { redirectTo } = queryString.parse(location.search);
      navigate(redirectTo == null ? "/" : redirectTo);
    }else{
      navigate("/verify-email");
    }
  }

  if (signupPageState.pending == true && signupPageState.loading == false && !signupPageState.error && verifyState.userVerified != null) {
    if (verifyState.userVerified) {
      console.log(signupPageState);
      dispatch(signupLoggedIn());
    }else{
      navigate("/verify-email");
    }
  }

  if (signupPageState.pending == false && signupPageState.error){
    enqueueSnackbar(signupPageState.errmsg, { variant: 'error', autoHideDuration: NotificationDuration });
  }

  useEffect(() => {
    // Update the document title using the browser API
    dispatch(getCurrentNumberRegistered())

    document.title = `LQWD | Sign Up`;

    window.addEventListener('resize', handleWindowSizeChange);
    return () => {
      window.removeEventListener('resize', handleWindowSizeChange);

    }
  }, []);

  return (
    <>
      { isMobile ?
        <LoginLayoutMobile children={
          <>
            <BetaSignupFormMobile numOfSpots={signupPageState.numberOfSpots.data} handleRegistration={handleSignUp}/>
            <Mfa show={showMfa} onCancel={() => setShowMfa(false)}
                 mfaUrl={"otpauth://totp/LQwD:"+userName+"?secret="+mfaValues.mfaValue+"&issuer=LQwD"}
                 secret={mfaValues.mfaValue} onActivate={validateMfaLogin}
                 mobile={isMobile}>

            </Mfa>
          </>
        }>
        </LoginLayoutMobile>
        :
        <LoginLayout children={
          <>
            <BetaSignupForm numOfSpots={signupPageState.numberOfSpots.data} handleRegistration={handleSignUp}/>
            <Mfa show={showMfa} onCancel={() => setShowMfa(false)}
                 mfaUrl={"otpauth://totp/LQwD:"+userName+"?secret="+mfaValues.mfaValue+"&issuer=LQwD"}
                 secret={mfaValues.mfaValue} onActivate={validateMfaLogin} mobile={isMobile}></Mfa>
          </>
        }>
        </LoginLayout>
      }
    </>
  );
};

export default SignupPage;