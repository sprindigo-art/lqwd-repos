/* eslint-disable */
import React, { useEffect } from 'react';
import './VerifyLandingPage.sass'
import { useDispatch, useSelector } from "react-redux";
import BlockUi from 'react-block-ui';
import { useNavigate } from "react-router-dom";
import { requestConfirmVerifyEmail } from "../../requests/Verify";
import { useSnackbar } from "notistack";
import NotificationDuration from "../../NotificationDuration";
import { useSearchParams } from "react-router-dom";

export default function VerifyLandingPage() {

    const verifyState = useSelector(state => state.verifyReducer);
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    let [searchParams, setSearchParams] = useSearchParams();
    const navigate = useNavigate();
    if (verifyState.userVerified) {
        navigate("/");
    }

    useEffect(() => {
        requestConfirmVerifyEmail({ token: searchParams.get("token") })
            .then(function (response) {
                console.log(response);
                if (response.status === 200) {
                    navigate("/verify-email");
                } else {
                    //   enqueueSnackbar('Failed to Verify Email.', { variant: 'error', autoHideDuration: NotificationDuration });
                    navigate("/verify-email");
                }
            }).catch(function (error) {
                console.log(error);
                // enqueueSnackbar('Failed to Verify Email.', { variant: 'error', autoHideDuration: NotificationDuration });
                navigate("/verify-email");
            });
    }, []);

    return (
        <div className='d-flex' style={{ width: '100vw', height: '100vh' }}>
            <div className='w-100 text-center'>
                <div className='h-100 d-flex flex-column justify-content-center'>
                    <div>
                        <h2>please wait...</h2>
                    </div>
                    <BlockUi tag="div" blocking={true}>

                    </BlockUi>

                </div>
            </div>
        </div>
    );
}
