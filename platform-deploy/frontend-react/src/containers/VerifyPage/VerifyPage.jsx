/* eslint-disable */
import React, { useState, useEffect } from "react";
import LoginLayoutMobile from "../../layouts/LoginLayout/LoginLayoutMobile";
import LoginLayout from "../../layouts/LoginLayout/LoginLayout";
import { useDispatch, useSelector } from "react-redux";
import VerifyEmail from "../../components/VerifyEmail/VerifyEmail";
import { verifyGetEmail } from "./VerifyPageActions";
import { requestSendVerifyEmail } from "../../requests/Verify";
import { useSnackbar } from "notistack";
import NotificationDuration from "../../NotificationDuration";
import Moment from "moment";

const VerifyPage = () => {

  const verifyState = useSelector(state => state.verifyReducer)
  const dispatch = useDispatch();
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();



  const restrictClick = () => {
    const endTime = Moment().add('5m');
    console.log(endTime);
  }
  const handleSendEmailOnClick = (email) => {
    console.log(email);
    // restrictClick();
    //set text to info panel restrict click for 5 min

    requestSendVerifyEmail({ email: email })
      .then(function (response) {
        console.log(response);
        if (response.status === 200) {
          enqueueSnackbar('Successfully Sent Verification Email!', { variant: 'success', autoHideDuration: NotificationDuration });
        } else {
          enqueueSnackbar('Failed to Send Verification Email.', { variant: 'error', autoHideDuration: NotificationDuration });
        }
      }).catch(function (error) {
        console.log(error);
        enqueueSnackbar('Failed to Send Verification Email.', { variant: 'error', autoHideDuration: NotificationDuration });
      });
  };

  const [width, setWidth] = useState(window.innerWidth);

  const isMobile = width <= 768;

  function handleWindowSizeChange() {
    setWidth(window.innerWidth);
  }

  console.log(verifyState.userEmail);
  // Similar to componentDidMount and componentDidUpdate:
  useEffect(() => {
    // Update the document title using the browser API
    if (verifyState.userVerified == null) {
      dispatch(verifyGetEmail());
    }
    document.title = `LQWD | Verify Email`;

    window.addEventListener('resize', handleWindowSizeChange);
    return () => {
      window.removeEventListener('resize', handleWindowSizeChange);
    }
  }, []);

  //wait until get results of verification
  if (verifyState.userVerified == null) {
    return (
      <></>
    );
  }

  return (
    <>
      {isMobile ?
        <LoginLayoutMobile
          children={
            <VerifyEmail
              isMobile={isMobile}
              email={verifyState.userEmail}
              handleClick={() => handleSendEmailOnClick(verifyState.userEmail)}
              isVerified={verifyState.userVerified} />
          }></LoginLayoutMobile>
        :
        <LoginLayout
          children={
            <VerifyEmail
              isMobile={isMobile}
              email={verifyState.userEmail}
              handleClick={() => handleSendEmailOnClick(verifyState.userEmail)}
              isVerified={verifyState.userVerified} />
          }></LoginLayout>
      }
    </>
  )
};

export default VerifyPage;