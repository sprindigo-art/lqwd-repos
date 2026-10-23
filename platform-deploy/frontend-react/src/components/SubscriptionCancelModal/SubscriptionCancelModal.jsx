/* eslint-disable */
import './SubscriptionCancelModal.css';
import React from 'react';
import DangerButton from "../Buttons/DangerButton";
import InheritButton from "../Buttons/InheritButton";
import { Modal } from 'react-bootstrap';
import PrimaryButton from "../Buttons/PrimaryButton";
import successIcon from '../../public/icons/subscription/Check.svg';
import closeButton from '../../public/icons/general/svg/Close.svg';

export default function SubscriptionCancelModal({ show, showConfirm, handleHide, onDone,
                                                  handleConfirm, goBack, node, balance }) {

  return (
    <>
      <Modal centered className="" show={show} onHide={handleHide} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="mx-2">
          <div className='d-flex'>
            <div><h1>Cancel Subscription</h1></div>
          </div>
        </Modal.Header>
        <Modal.Body className="mx-2">
          <div>
            {
              balance > 0 ?
              <div className=" px-3">
                You will need to have "0" balance on {node}, please empty all funds on your Node to delete it.
              </div>
            :
              <div className=" px-3">
                Are you sure you want to cancel your subscription for {node}?
              </div>
            }
            {
              balance > 0 ?
                <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                  <InheritButton text='Back' onClick={goBack}></InheritButton>
                  <DangerButton text='Okay' onClick={handleHide}></DangerButton>
                </div>
                :
                <div className=" mb-3 d-flex justify-content-end px-3 my-3">
                  <InheritButton text='Back' onClick={goBack}></InheritButton>
                  <DangerButton text='Confirm' onClick={handleConfirm}></DangerButton>
                </div>
            }
          </div>
        </Modal.Body>
      </Modal>
      <Modal centered className="" show={showConfirm} onHide={handleHide} backdrop='static' keyboard="False">
        <div className="align-self-end pt-3 px-3" style={{cursor: "pointer"}} onClick={onDone}>
          <img src={closeButton}/>
        </div>
        <div className="p-4 align-self-center">
          <img src={successIcon} alt={"success"} width={"46px"} height={"46px"}/>
        </div>
        <div className='d-flex justify-content-center center'>
          <div><h1>Delete Successful</h1></div>
        </div>
        <Modal.Body className="mx-2">
          <div className=" mb-3 d-flex justify-content-center px-3 ">
            <PrimaryButton text='Done' onClick={onDone}></PrimaryButton>
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
}