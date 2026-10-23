/* eslint-disable */
import React, { useState, useEffect } from 'react';
import tourImage from '../../../public/icons/login/tourstep2.svg';
import Button from '../../Buttons/PrimaryButton';

export default function Step2({ goForward }) {

    return (

        <div >
            <div className='d-flex justify-content-center my-5'><img src={tourImage} alt="" /></div>
            <div className='title'><h1>Create node to get started</h1></div>
            <div className='description'>Treat node like your wallet, all transactions require a node to process.</div>
            <div className='d-flex my-3 buttons'>
                <div>
                    <span className="dot selected"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
                </div>
                <div className='ms-auto'>
                    <Button className='mx-2' text='Got it' onClick={() => goForward()}> </Button>
                </div>
            </div>
        </div>

    );
}