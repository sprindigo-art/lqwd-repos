/* eslint-disable */
import React, { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import LoginLayout from "../../layouts/LoginLayout/LoginLayout";
import ResetPasswordConfirm from "../../components/ResetPasswordConfirm/ResetPasswordConfirm";
import { useDispatch, useSelector } from "react-redux";
import { confirmResetPassword } from "./ConfirmResetPasswordActions";
import LoginLayoutMobile from "../../layouts/LoginLayout/LoginLayoutMobile";
import { useSnackbar } from "notistack";
import NotificationDuration from "../../NotificationDuration";
import Mfa from "../../components/LoginComponent/Mfa/Mfa";
import { signupPageLogin } from "../SignupPage/SignupPageActions";
import { requestConfirmPasswordReset } from "../../requests/Verify";
import queryString from "query-string";
import { useAuth } from "../../hooks/useAuth";

export default function ConfirmResetPassword() {

  const confirmResetState = useSelector(state => state.confirmResetPasswordReducer);
  const signupState = useSelector(state => state.signupPageReducer);
  const verifyState = useSelector(state => state.verifyReducer);

  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { login } = useAuth();
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  const [searchParams, setSearchParams] = useSearchParams();

  const [token, setToken] = useState(searchParams.get("token"));
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');

  const [showMfa, setShowMfa] = useState(false);

  const onResetPassword = (password) => {
    console.log(token, password);
    if (token == null){
      enqueueSnackbar("Token Expired Please Resent Reset Password", { variant: 'error', autoHideDuration: NotificationDuration });
    }else {
      setPassword(password);
      // dispatch(confirmResetPassword(password, token));
      requestConfirmPasswordReset({ password: password, token: token })
        .then(function(response) {
          console.log(response);
          response = JSON.parse(response);

          if (response.status === 200) {
            enqueueSnackbar('Successfully Updated Password', {
              variant: 'success',
              autoHideDuration: NotificationDuration
            });
            setUsername(JSON.parse(response.object).username);
            setMfaSecret(JSON.parse(response.object).mfaSecret);

            setShowMfa(true);
          } else {
            enqueueSnackbar(JSON.parse(response.error).error, {
              variant: 'error',
              autoHideDuration: NotificationDuration
            });
          }
        }).catch(function(error) {
        enqueueSnackbar(error, { variant: 'error', autoHideDuration: NotificationDuration });
      });
    }
  };


  const validateMfaLogin = (value) => {
    console.log(username, password, value);
    dispatch(signupPageLogin(username, password, value));
  };

  const redirectToLogin = () => {
    navigate('/login');
  };

  const [width, setWidth] = useState(window.innerWidth);

  function handleWindowSizeChange() {
    setWidth(window.innerWidth);
  }

  const isMobile = width <= 768;

  if (signupState.pending == true && signupState.loading == false && signupState.user) {
    console.log(signupState);
    if(verifyState.userVerified){
      login(signupState.user);
      const location = useLocation();
      const { redirectTo } = queryString.parse(location.search);
      navigate(redirectTo == null ? "/" : redirectTo);
    }else{
      navigate("/login");
    }
  }

  console.log(confirmResetState);
  useEffect(() => {
    document.title = "LQwD | Reset Password";

    window.addEventListener('resize', handleWindowSizeChange);
    return () => {
      window.removeEventListener('resize', handleWindowSizeChange);
    }
  }, []);

  return (
    <>
      { isMobile ?
        <LoginLayoutMobile
          children={
          <>
            <ResetPasswordConfirm
              handleConfirmPassword={onResetPassword}
              mobile={isMobile}/>
            {showMfa ?
              <Mfa show={showMfa}
                   onCancel={() => redirectToLogin()}
                   mfaUrl={"otpauth://totp/LQwD:"+username+"?secret="+mfaSecret+"&issuer=LQwD"}
                   secret={mfaSecret}
                   onActivate={validateMfaLogin}
                   mobile={isMobile}>
              </Mfa>
                :
              <></>
            }
          </>

          }>
        </LoginLayoutMobile>
        :
        <LoginLayout
          children={
          <>
            <ResetPasswordConfirm
              handleConfirmPassword={onResetPassword}
              mobile={isMobile}/>
            {showMfa ?
              <Mfa show={showMfa}
                   onCancel={() => redirectToLogin()}
                   mfaUrl={"otpauth://totp/LQwD:" + username + "?secret=" + mfaSecret + "&issuer=LQwD"}
                   secret={mfaSecret}
                   onActivate={validateMfaLogin}
                   mobile={isMobile}></Mfa>
              :
              <></>
            }
          </>


          }>

        </LoginLayout>
      }
    </>
  );
}