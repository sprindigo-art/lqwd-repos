/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { Modal } from 'react-bootstrap';
import PaymentStep from '../../components/CreateNode/PaymentStep'
import { useSelector, useDispatch } from 'react-redux';
import { hideSubscriptionInvoiceModal } from '../SubscriptionInvoiceModal/SubscriptionInvoiceModalReducer'


export default function SubscriptionInvoiceModal() {
    const reducer = useSelector(state => state.SubscriptionInvoiceModalReducer);
    const dispatch = useDispatch();

    return (
        <>
            <Modal centered size="lg" className=".subscription-invoice-modal" show={reducer.showModal} onHide={() => dispatch(hideSubscriptionInvoiceModal())} backdrop='static' keyboard="False">
                <Modal.Header closeButton className='border-0'>
                    <div className="p-2 container create-node-title">Invoice</div>
                </Modal.Header>
                <Modal.Body>
                    <PaymentStep
                      step={4}
                      satAmount={reducer.payment.amount}
                      amount={reducer.payment.amountUsd}
                      btcRate={reducer.payment.rateUsd}
                      address={reducer.paymentAddress}
                      startDate={reducer.payment.startDate}
                      endDate={reducer.payment.endDate}
                      onFinish={() => dispatch(hideSubscriptionInvoiceModal())} ></PaymentStep>
                </Modal.Body>
            </Modal>
        </>
    );
}