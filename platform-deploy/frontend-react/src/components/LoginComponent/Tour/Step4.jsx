/* eslint-disable */
import React, { useState, useEffect } from 'react';
import tourImage from '../../../public/icons/login/tourstep4.svg';
import Button from '../../Buttons/PrimaryButton';
import InheritBotton from '../../Buttons/InheritButton';

export default function Step4({ onClose, goBack }) {

    return (

        <div >
            <div className='d-flex justify-content-center my-5'><img src={tourImage} alt="" /></div>
            <div className='title'> <h1>Send and request LN payment</h1></div>
            <div className='description'>Instantly, cheaply, send and request LN payment with ease</div>
            <div className='d-flex my-3 buttons'>
                <div>
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot selected"></span>
                </div>
                <div className='ms-auto d-flex'>
                    <InheritBotton className='mx-2' text='Back' onClick={() => goBack()}> </InheritBotton>
                    <Button className='mx-2' text='Start' onClick={() => onClose()}> </Button>
                </div>
            </div>
        </div>

    );
}