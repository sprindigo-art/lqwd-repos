/* eslint-disable */
import React, { useState } from "react";
import { Modal } from "react-bootstrap";
import Password from "../Basic/Password";
import PrimaryButton from "../Buttons/PrimaryButton";
import Input from "../Basic/Input";
import Select from "../Basic/Select";
import './AddUserModal.css';

export default function AddUserModal({show, nodeList, handleHide, onClose, onBack, onConfirm, roleList}){

  console.log(email, node, role, password);
  const [email, setEmail] = useState("");
  const [node, setNode] = useState("");
  const [role, setRole] = useState("");

  const [password, setPassword] = useState("");
  const [activeBtn, setActiveBtn] = useState(true);

  const onEmailChange = (value) => {
    console.log(value);
    setEmail(value);
  };
  const onRoleSelect = (value) => {
    console.log(value);
    setRole(value);
  };
  const onNodeSelect = (value) => {
    console.log(value);
    setNode(value);
    setActiveBtn(false);
  };
  const onPasswordChange = (value) => {
    console.log(value);
    setPassword(value);
  };

  const reset = () => {
    setEmail("");
    setRole("");
    setNode("");
    setPassword("");
    setActiveBtn(true);
    handleHide();
  };

  const confirmAdd = (email, node, role, password) => {
    onConfirm(email, node, role, password);
    reset();
  };

  return (
    <>
      <Modal centered className="" show={show} onHide={reset} backdrop='static' keyboard="False">
        <Modal.Header closeButton className="border-0 mx-2">
          <div className="add-user-modal-title">
            Add User to Share Node Access
          </div>
        </Modal.Header>
        <Modal.Body className="mx-2">
          <div className="add-user-modal-form">
            <div className="add-user-modal-form-row">
              <Input label={"Email"}
                     onChange={() => onEmailChange(event.target.value)}/>
            </div>
            <div className="add-user-modal-form-row">
              <Select label={"Select Node"}
                      placeholder={"Select Node From List..."}
                      options={nodeList}
                      onChange={onNodeSelect} />
            </div>
            <div className="add-user-modal-form-row">
              <Select label={"Select Privileges for User"}
                      placeholder={"Select Role for User..."}
                      options={roleList}
                      onChange={onRoleSelect} />
            </div>
            <div className="add-user-modal-form-row">
              <Password label={"Set New User's Node Passphrase"} onChange={onPasswordChange}/>
            </div>

          </div>
        </Modal.Body>
        <Modal.Footer>
          <PrimaryButton text={"Add"} onClick={() => confirmAdd(email, node, role, password)} disabled={activeBtn || node === undefined}></PrimaryButton>
        </Modal.Footer>
      </Modal>
    </>
  );
}