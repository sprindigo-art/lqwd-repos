/* eslint-disable */
import React, { useEffect, useState } from "react";
import PrimaryOutlineButton from '../../components/Buttons/PrimaryOutline'
import InheritButton from '../Buttons/InheritButton'
import PrimaryButton from '../Buttons/PrimaryButton'
import checkImage from '../../public/icons/subscription/Check.svg';
import { setActiveStep } from '../../containers/CreateNode/CreateNodeActions'


const SelectPaymentStep = ({ onPaymentSelected, step, dispatch }) => {
    const [paymentMethod, setPaymentMethod] = useState(-1);

    return (
        <div className={`create-node-select-payment create-node-step-${step} py-2`}>
            <div className='d-flex justify-content-center mb-2'>
                <div className={paymentMethod == 0 ? 
                    'subscription-payment-lnd subscription-payment-item mx-2 p-2 subscription-payment-item-selected' :
                    'subscription-payment-lnd subscription-payment-item mx-2  p-2 '}>
                    <div className='mx-4'><h1>Lightning Network</h1></div>
                    <div className='d-flex mx-4 flex-grow-1 justify-content-center px-2'>Pay via Lightning Network and get Node set up instantly</div>

                    <div className='w-100 d-flex justify-content-center'><PrimaryOutlineButton text={"Pay via LTN"} onClick={() => setPaymentMethod(0)}></PrimaryOutlineButton></div>
                    <div className='selected-image'><img src={checkImage} /></div>
                </div>
                <div className={paymentMethod == 1 ? 
                    'subscription-payment-bitcoin subscription-payment-item mx-2  p-2 subscription-payment-item-selected' :
                    'subscription-payment-bitcoin subscription-payment-item mx-2  p-2 '}>
                    <div className='mx-4'><h1>Bitcoin</h1></div>
                    <div className='d-flex mx-4 flex-grow-1 justify-content-center px-2'>Pay On-Chain via Bitcoin</div>
                    <div className='w-100 d-flex justify-content-center'><PrimaryOutlineButton text={"Pay via BTC"} onClick={() => setPaymentMethod(1)}></PrimaryOutlineButton></div>
                    <div className='selected-image'><img src={checkImage} /></div>
                </div>
            </div>
            <div>
                <div className="d-flex justify-content-end px-3" >
                    <InheritButton text='Back' onClick={() => dispatch(setActiveStep(2))}></InheritButton>
                    <PrimaryButton
                        text='Continue'
                        className='continue-to-next-step-btn'
                        disabled={paymentMethod == -1}
                        onClick={() => onPaymentSelected(paymentMethod)}></PrimaryButton>

                </div>
            </div>
        </div>
    );
};

export default SelectPaymentStep;

