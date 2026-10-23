/* eslint-disable */
import React, { useState, useEffect } from 'react';
import tourImage1 from '../../../public/icons/login/tourstep1.svg';
import Button from '../../Buttons/PrimaryButton';

export default function Step1({goForward}) {

    return (

        <div >
            <div className='d-flex justify-content-center my-5'><img src={tourImage1} alt="" /></div>
            <div className='title'><h2>Welcome to LQwD Lightning Network</h2></div>
            <div className='description'>Transact With Bitcoin Using the Lightning Network.</div>
            <div className='d-flex justify-content-center my-3 buttons'><Button className='mx-2' text='Check out short tutorial' onClick={() => goForward()}> </Button></div>
        </div>

    );
}