import React, { useState } from "react";
import { Modal } from "react-bootstrap";
import PrimaryButton from "../Buttons/PrimaryButton";
import "./CreditCardModal.css";
import Input from "../Basic/Input";
import Card from "react-credit-card-component";
import "react-credit-card-component/dist/styles-compiled.css";
import PrimaryOutlineButton from "../Buttons/PrimaryOutline";

export default function CreditCardPayNow({show, handleClose,
                                           handlePayAction, handleUpdateAction,
                                           nodeName, amount, update}){

  const [step, setStep] = useState(0);

  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [cvc, setCvc] = useState("");
  const [expiry, setExpiry] = useState("");

  const [state, setState] = useState(
    {
    cvc: "",
    expiry: "",
    focus: "",
    name: "",
    number: "",
  });

  const handleInputFocus = (e) => {
    console.log(e.target.value);
    setState({
      ...state,
      [name]: value
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setState({
      ...state,
      [name]: value
    });
  };

  const onPay = (state, update) => {
    console.log(state);

    if (update){
      handleUpdateAction(state);
    }else {
      handlePayAction(state);
    }
  };

  return (
    <>
      <Modal centered show={show} size={'lg'} onHide={handleClose} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="credit-card-modal-header">
          {!update ?
            <>
              Pay For Node - {nodeName ? nodeName : ""}
            </>
            :
            <>
              Update Credit Card Information
            </>
          }
        </Modal.Header>
        <Modal.Body className="mx-2 row col-12">
          <div className="credit-card-modal-form col-6">
            <div className="credit-card-modal-form-row">
              <div className="credit-card-modal-form-col col-12">
                <div className="credit-card-modal-form-label">
                  Enter Credit Card Number
                </div>
                <Input
                  type={"tel"}
                  name={"number"}
                  placeHolder={"Enter Card Number"}
                  onChange={handleInputChange}
                  onFocus={handleInputFocus} />
              </div>
            </div>
            <div className="credit-card-modal-form-row">
              <div className="credit-card-modal-form-col col-12">
                <div className="credit-card-modal-form-label">
                  Enter Full Name on Credit Card
                </div>
                <Input
                  name={"name"}
                  placeHolder={"Enter Full Name"}
                  onChange={handleInputChange}
                  onFocus={handleInputFocus} />
              </div>
            </div>
            <div className="credit-card-modal-form-row">
              <div className="credit-card-modal-form-col col-4">
                <div className="credit-card-modal-form-label">
                  CSV
                </div>
                <Input
                  type={"tel"}
                  name={"cvc"}
                  placeHolder={"3 Digits"}
                  onChange={handleInputChange}
                  onFocus={handleInputFocus} />
              </div>
              <div className="credit-card-modal-form-col col-4">
                <div className="credit-card-modal-form-label">
                  Expiry Date
                </div>
                <Input
                  name={"expiry"}
                  placeHolder={"MM/YY"}
                  onChange={handleInputChange}
                  onFocus={handleInputFocus} />
              </div>
              <div className="credit-card-modal-form-col col-4">
                <div className="credit-card-modal-form-label">
                  Postal Code
                </div>
                <Input
                  name={"postal"}
                  placeHolder={"ABC 123"}
                  onChange={handleInputChange}
                  onFocus={handleInputFocus} />
              </div>
            </div>
          </div>
          <div className="credit-card-modal-form col-6">
            <Card
              cvc={state.cvc}
              expiry={state.expiry}
              name={state.name}
              number={state.number}
              placeholders={{
                name: "Full Name"
              }}
              locale={{
                valid: "Expiry"
              }}
              acceptedCards={['visa', 'mastercard', 'amex']}
            />
          </div>
          <div className="col-12 mb-3 d-flex justify-content-end pt-3 pr-0 gap-2">
            <PrimaryOutlineButton text='Cancel' onClick={handleClose}></PrimaryOutlineButton>
            <PrimaryButton text={!update ? `Pay ${amount ? amount : ""}` : `Update Info`}
                           onClick={() => onPay(state, update)}></PrimaryButton>
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
}