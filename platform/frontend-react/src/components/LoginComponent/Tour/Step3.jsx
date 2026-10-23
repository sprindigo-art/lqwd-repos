/* eslint-disable */
import React, { useState, useEffect } from 'react';
import tourImage from '../../../public/icons/login/tourstep3.svg';
import Button from '../../Buttons/PrimaryButton';
import InheritBotton from '../../Buttons/InheritButton';

export default function Step3({ goForward, goBack }) {

    return (

        <div >
            <div className='d-flex justify-content-center my-5'><img src={tourImage} alt="" /></div>
            <div className='title'><h2>Fund your node</h2></div>
            <div className='description'>Transfer Bitcoin to your node from your wallet outside of LQwD.</div>
            <div className='d-flex my-3 buttons'>
                <div>
                    <span className="dot"></span>
                    <span className="dot selected"></span>
                    <span className="dot"></span>
                </div>
                <div className='ms-auto d-flex'>
                    <InheritBotton className='mx-2' text='Back' onClick={() => goBack()}> </InheritBotton>
                    <Button className='mx-2' text='Okay' onClick={() => goForward()}> </Button>
                </div>
            </div>
        </div>

    );
}