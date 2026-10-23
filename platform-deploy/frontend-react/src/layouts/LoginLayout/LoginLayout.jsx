/* eslint-disable */
import React from 'react';
import './LoginLayout.css';
import Balance from '../../components/NodeBalance/Balance';


export default function LoginLayout({ children }) {

    return (
        <div className='login-layout' >
            <div className='background'>
                <div className='right-panel' >
                    <div className="shape shape-1"> </div>
                    <div className="shape shape-2"> </div>
                    <div className="shape shape-3"> </div>
                    <div className="shape shape-4"> </div>

                    <div style={{ paddingLeft: '50%', height: '100%' }}>
                        <div style={{ height: '50%' }} className='d-flex justify-content-center flex-column'>
                            <Balance balanceHistory={[]} currency={{
                                code: 'sats',
                                name: 'Satoshis',
                                rate: 1,
                            }} sent={0} received={0} balance={0} />
                        </div>
                        <div style={{ height: '50%' }} className='d-flex justify-content-center flex-column'>
                            <div className='mx-auto login-text d-flex justify-content-center flex-column text-center p-3' style={{ height: '50%', width: '40%', zIndex: '10', position: 'relative' }} >


                                <div className='square' style={{ width: '20px', height: '20px', position: 'absolute', top: '-10px', left: '-10px' }}> </div>
                                <div className='square' style={{ width: '20px', height: '20px', position: 'absolute', top: '-10px', right: '-10px' }}> </div>
                                <div className='square' style={{ width: '20px', height: '20px', position: 'absolute', bottom: '-10px', left: '-10px' }}> </div>
                                <div className='square' style={{ width: '20px', height: '20px', position: 'absolute', bottom: '-10px', right: '-10px' }}> </div>
                                <div>
                                <span style={{color: 'white', textAlign: 'center', margin:'10px'}}>
                                    <h1>Lightning Network Infrastructure For Global Scale</h1>
                                    Usable anywhere in the world.
                                </span>

                                </div>
                            </div>
                        </div>

                    </div>

                </div>
            </div >
            <div className='input-panel'>
                {children}
            </div>
        </div >
    );
}
