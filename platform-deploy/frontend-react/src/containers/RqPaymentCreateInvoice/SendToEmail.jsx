/* eslint-disable */
import React from 'react';
import {Modal} from "react-bootstrap";
import PrimaryButton from "../../components/Buttons/PrimaryButton";
import InfoPanel from "../../components/InfoPanel/InfoPanel";
import Input from "../../components/Basic/Input";

const SendInvoiceModal = ({show, onHideCallback, handleBtnCallback, emailCallback,
                          info}) => {

    return (
        <div>
            <Modal centered className="cust-modal-sm" show={show} size='md' onHide={onHideCallback} backdrop='static'
                   keyboard="true">
                <Modal.Header closeButton className="cus-header">
                    <div id="nodeFundModal" className="flex-column cus-sub-header justify-content-around">
                        <div className="d-sm-flex flex-row align-items-center">
                            <div className="details-title">
                                Send Invoice
                            </div>
                        </div>
                    </div>
                </Modal.Header>

                <Modal.Body>
                    <InfoPanel warn={true} text={info}/>

                    <div className={"mt-3"}>
                        <Input label={"Email"} name={"email"} onChange={(event) => emailCallback(event)}/>
                    </div>


                    <div className="col-12 mb-3 d-flex justify-content-end pt-3 pr-0">
                        <PrimaryButton text='Send Invoice' onClick={handleBtnCallback}></PrimaryButton>
                    </div>
                </Modal.Body>
            </Modal>

        </div>
    );
}

export default SendInvoiceModal;


