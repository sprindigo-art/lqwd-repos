/* eslint-disable */
import React, { useState } from "react";
import "./SubscriptionPayByModal.css";
import { Modal } from "react-bootstrap";
import PrimaryOutlineButton from "../Buttons/PrimaryOutline";
import CopyText from "../CopyText/CopyText";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";
import DownloadImg from "../../public/icons/general/png/Download.png";
import PrimaryButton from "../Buttons/PrimaryButton";
import InfoPanel from "../InfoPanel/InfoPanel";
import Moment from "moment";
import processImg from "../../public/icons/general/png/Process@2.png";
import WasteIcon from "../../public/icons/general/png/Waste.png";

export default function SubscriptionPayByModal({show, handleClose, handleBack, handleContinue, invoice,
                                                 handlePayAction, downloadButtonClicked,
                                                 currentInvoice, showInvoice,}){

  const [step, setStep] = useState(0);

  const onPay = (type, id) => {
    handlePayAction(type, id);
    setStep(step+1);
  }
  const onContinue = () => {
    setStep(step+1);
  };

  const onDone = () => {
    handleClose();
  }
  const onBack = () => {
    setStep(step-1);
  };

  return (
    <>
      <Modal centered show={show && step === 0} size={'lg'} onHide={handleClose} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="subscription-invoice-modal-header">
          Pay Bill
        </Modal.Header>
        <Modal.Body className="mx-3">
          <div className="subscription-invoice-modal-table">
            <div className="subscription-invoice-modal-table-container">
              {
                currentInvoice.subscriptions.map((item) => (
                  <div className="subscription-invoice-modal-table-row">
                    <div className="subscription-invoice-modal-table-col">{item.nodeId}</div>
                    <div className="subscription-invoice-modal-table-col">{item.product.productName} Plan</div>
                    <div className="subscription-invoice-modal-table-col">{Moment(item.dateCreated).format("MMM-DD")}-{Moment(item.expiry).format("MMM-DD")}</div>
                    <div className="subscription-invoice-modal-table-col">{item.subscriptionPlan.price} Sats</div>
                  </div>
                ))
              }
            </div>
          </div>
          <div className="subscription-invoice-modal-total-table">
            <div className="subscription-invoice-modal-total-table-container">
              {
                currentInvoice.tax != null ?
                  <>
                    <div className="subscription-invoice-modal-total-table-row">
                      <div className="subscription-invoice-modal-total-table-col">Subtotal</div>
                      <div className="subscription-invoice-modal-total-table-col">{(currentInvoice.amount-currentInvoice.tax).toFixed(2)} Sats</div>
                    </div>
                    <div className="subscription-invoice-modal-total-table-row">
                      <div className="subscription-invoice-modal-total-table-col">Tax</div>
                      <div className="subscription-invoice-modal-total-table-col">{currentInvoice.tax.toFixed(2)} Sats</div>
                      <div className="subscription-invoice-modal-total-table-row">
                        <div className="subscription-invoice-modal-total">Total</div>
                        <div className="subscription-invoice-modal-total">{currentInvoice.amount.toFixed(2)} Sats</div>
                      </div>
                    </div>
                  </>
                  :
                <div className="subscription-invoice-modal-total-table-row">
                  <div className="subscription-invoice-modal-total">Total</div>
                  <div className="subscription-invoice-modal-total">{currentInvoice.amount.toFixed(2)} Sats</div>
                </div>
              }


            </div>
          </div>
          <div className="col-12 mb-3 d-flex justify-content-between pt-3 pr-0">
            <PrimaryOutlineButton text='Pay via LTN' onClick={() => onPay("ln", currentInvoice.id)}></PrimaryOutlineButton>
            <PrimaryOutlineButton text='Pay via BTC' onClick={() => onPay("btc", currentInvoice.id)}></PrimaryOutlineButton>
          </div>
        </Modal.Body>
      </Modal>

      <Modal centered show={invoice == null && step === 1} size={'lg'} onHide={handleClose} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="subscription-invoice-modal-header">
          Pay Bill
        </Modal.Header>
        <Modal.Body className="mx-3">
          <div className="node-details-creating d-flex justify-content-center flex-column">
            <div className='d-flex justify-content-center my-2'>
              <img src={processImg} alt="" className='rotate' />
            </div>
            <div className='d-flex justify-content-center'>
              <h2>Creating Invoice</h2>
            </div>
            <div className='d-flex justify-content-center'>
              <p>Please wait, we are working hard on creating your invoice or address :) <br />It will take a few minutes to complete. </p>
            </div>
          </div>
        </Modal.Body>
      </Modal>

      <Modal centered show={invoice != null && step === 1} size={'lg'} onHide={handleClose} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="subscription-invoice-modal-header">
          Pay Bill
        </Modal.Header>
        <Modal.Body className="mx-3">
          <div className="subscription-pay-by-modal-container">
            <div className="subscription-pay-by-modal-row">
              <div className="subscription-pay-by-modal-col">
                <div className="subscription-pay-by-modal-col-title"> Please send {currentInvoice.amount} sats to:</div>
                <CopyText text={invoice} classNames={"subscription-pay-by-modal-text-area"}></CopyText>
              </div>
              <div className="subscription-pay-by-modal-col">
                <div className="subscription-pay-by-modal-col-title">QR-Code</div>
                <div className="subscription-pay-by-modal-qr-code">
                  <div className="subscription-pay-by-modal-qr-code-frame">
                    <div className="subscription-pay-by-modal-qr-code-border">
                      <QRCodeCanvas value={invoice}></QRCodeCanvas>
                      <div className="subscription-pay-by-modal-qr-code-download">
                        <img className="subscription-pay-by-modal-qr-code-download-icon" onClick={() => downloadButtonClicked()} src={DownloadImg}/>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="col-12 mb-3 d-flex justify-content-end pt-3 pr-0 gap-2">
            <PrimaryOutlineButton text='Back' onClick={() => onBack()}></PrimaryOutlineButton>
            <PrimaryButton text='Continue' onClick={() => onContinue()}></PrimaryButton>
          </div>
        </Modal.Body>
      </Modal>

      <Modal centered show={show && step === 2} onHide={handleClose} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="subscription-invoice-modal-header">
          <div className="center">
            Node Reactivated
          </div>
        </Modal.Header>
        <Modal.Body className="mx-3">
          <div className="subscription-pay-by-modal-container">
            <div className="subscription-pay-by-modal-row">
              <InfoPanel text={"Payment needs to be completed within 72 hours before it expires"} info={true}></InfoPanel>
            </div>
            <div className="subscription-pay-by-modal-row justify-content-center">
              <div className="subscription-pay-by-modal-col">
                <div className="subscription-pay-by-modal-row justify-content-center">
                  Total Amount: <b>{currentInvoice.amount} sats</b>
                </div>
                <div className="subscription-pay-by-modal-row">
                  Transaction Create Date: {Moment().format("MMM DD YYYY")}
                </div>
              </div>
            </div>
          </div>
          <div className="col-12 mb-3 d-flex justify-content-center pt-3 pr-0 gap-2">
            <PrimaryButton text='Done' onClick={() => onDone()}></PrimaryButton>
          </div>
        </Modal.Body>
      </Modal>

    </>
  );
}