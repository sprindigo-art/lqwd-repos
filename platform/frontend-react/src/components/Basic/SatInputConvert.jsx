/* eslint-disable */
import React, { useState, useEffect } from 'react';
import './Input.css';
import usdIco from '../../public/icons/dashboard/usd-ref-white.svg'



export default function SatInputConvert({ error, onChange, errorMsg, initialValue, name, label }) {
    const [value, setValue] = useState('');
    const [isSat, setIsSat] = useState(true);


    const headerOnChange = (event) => {
        event.preventDefault()
        setValue(event.target.value);
        onChange(event);

    };

    const changeCurrency = () =>{
        setIsSat(!isSat)
    }

    useEffect(() => {

        // Update the document title using the browser API
        setValue(initialValue);
    }, [
        value
    ]);

    return (
        <div className='text-input'>
            {label ? <div className='m-1 input-label'>{label}</div> : <></>}
            <div className="input-group d-flex justify-content-between form-control rounded-right">
                <input autoComplete="none" placeholder={"0"} style={{"appearance": "none"}} type="text" name={name} value={value} className={"col-md-10 border-0"} onChange={headerOnChange} required />

                <i className={"d-flex flex-row justify-content-center text-center"}>
                    <span className={"m-1 input-currency"}>{isSat ? 'sats' : 'BTC'}</span>
                    <svg id={"input-currency-ico"} onClick={changeCurrency} className={"m-1"} width="20" height="20" viewBox="0 0 20 20" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                        <path d="M9.94732 0C7.45645 0 5.17824 0.929132 3.42389 2.44531L2.19537 1.2168C1.73437 0.755797 0.947324 1.08042 0.947324 1.73242V4.99414C0.947324 5.54914 1.39718 6 1.95318 6H5.2149C5.8669 6 6.19348 5.21295 5.73248 4.75195L4.83795 3.85742C6.22459 2.70062 8.00071 2 9.94732 2C14.0658 2 17.455 5.11728 17.8985 9.11133C17.9131 9.24191 17.9533 9.36833 18.0167 9.48338C18.0802 9.59843 18.1657 9.69986 18.2683 9.78186C18.371 9.86387 18.4888 9.92484 18.615 9.96131C18.7412 9.99778 18.8734 10.009 19.004 9.9944C19.1346 9.97978 19.261 9.93958 19.376 9.87609C19.4911 9.81261 19.5925 9.72708 19.6744 9.6244C19.7564 9.52172 19.8174 9.4039 19.8538 9.27766C19.8902 9.15142 19.9014 9.01924 19.8868 8.88867C19.3323 3.89472 15.0768 0 9.94732 0ZM9.92975 3.59961C9.65275 3.59961 9.42779 3.82456 9.42779 4.10156V5.0293C9.08879 5.0723 7.19146 5.42875 7.19146 7.71875C7.19146 11.0597 10.6504 10.0718 10.6504 12.3008C10.6504 13.4168 9.93026 13.4434 9.78326 13.4434C9.66826 13.4434 9.00346 13.4946 8.81646 12.4336C8.75146 12.0626 8.40345 11.8066 8.02545 11.8066H7.76373C7.26873 11.8066 6.866 12.2513 6.961 12.7363C7.356 14.7503 9.01512 14.9327 9.28912 14.9707V15.8008C9.28912 16.0778 9.51212 16.3008 9.78912 16.3008C10.0661 16.3008 10.2911 16.0778 10.2911 15.8008V14.9707C10.6291 14.9287 12.5411 14.6132 12.5411 12.2852C12.5411 9.08016 9.08109 9.69356 9.08209 7.72656C9.08209 6.59956 9.70395 6.56445 9.83795 6.56445C10.0339 6.56445 10.4446 6.70489 10.6016 7.46289C10.6826 7.85689 11.0004 8.1543 11.4024 8.1543H11.6622C12.1862 8.1543 12.5652 7.66044 12.4512 7.14844C12.0662 5.41544 10.7116 5.10964 10.4376 5.05664V4.10156C10.4376 3.82456 10.2126 3.59961 9.93561 3.59961H9.92975ZM0.974668 9.98633C0.834948 9.98988 0.697526 10.0227 0.571262 10.0826C0.444999 10.1425 0.332699 10.2283 0.241605 10.3343C0.150511 10.4403 0.0826463 10.5642 0.0423877 10.698C0.00212919 10.8319 -0.00962933 10.9727 0.0078707 11.1113C0.562384 16.1053 4.81784 20 9.94732 20C12.4317 20 14.7045 19.0756 16.4571 17.5664L17.67 18.7793C18.142 19.2513 18.9473 18.918 18.9473 18.252V15.0098C18.9473 14.4528 18.4946 14 17.9376 14H14.6954C14.0294 14 13.697 14.8044 14.168 15.2754L15.0391 16.1465C13.6557 17.2989 11.8883 18 9.94732 18C5.8288 18 2.43964 14.8827 1.99615 10.8887C1.97152 10.637 1.85245 10.404 1.66292 10.2366C1.47339 10.0691 1.22747 9.97972 0.974668 9.98633Z" fill="currentColor"/>
                    </svg>
                </i>
            </div>
        </div>
    );
}
