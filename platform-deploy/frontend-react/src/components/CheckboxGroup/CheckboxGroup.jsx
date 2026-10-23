/* eslint-disable */
import React, { useState, useEffect, forwardRef, useRef, useImperativeHandle } from 'react';
import './CheckboxGroup.css'
import Checkbox from '@mui/material/Checkbox';
import FormGroup from '@mui/material/FormGroup';
import FormControlLabel from '@mui/material/FormControlLabel';

const CheckboxGroup = forwardRef(({ items, onChange }, ref) => {

    //all items plus first item that means all
    const [results, setResults] = useState(new Array(items.length + 1).fill(true).fill(false, 1));

    useImperativeHandle(ref, () => ({

        // getAlert() {
        //   alert("getAlert from Child");
        // },
        reset() {
            setResults(new Array(items.length + 1).fill(true).fill(false, 1));
        }
    
      })); 

    const sendResults = (res) => {
        if (res[0] == true) {
            onChange(items.map(a => a.label));
        } else {
            let ret = [];
            for (let i = 0; i < items.length; i++) {
                if (res[i + 1] == true) {
                    ret.push(items[i].label);
                }
            }
            onChange(ret);
        }
        setResults(res);
    }

    const itemChanged = (event, index) => {
        let res = JSON.parse(JSON.stringify(results));
        res[index] = event.target.checked;
        //if any other item is selected to true, all should set to false
        if (res[index]) {
            res[0] = false;
        }
        sendResults(res);
    }

    const onAllChange = (event) => {
        let res = JSON.parse(JSON.stringify(results));
        let value = event.target.checked;
        if (value) {
            res = new Array(items.length + 1).fill(false);
            res[0] = true;
        } else {
            res[0] = false;
        }
        sendResults(res);
    }



    const renderItems = (items) => {
        let ret = [];
        items.forEach((item, index) => {
            console.log(item.label);
            if (results[index + 1]) {
                ret.push(
                    <FormControlLabel control={<Checkbox checked={true} onChange={(e) => itemChanged(e, index + 1)} />} label={item.label} />
                );
            } else {
                ret.push(
                    <FormControlLabel control={<Checkbox checked={false} onChange={(e) => itemChanged(e, index + 1)} />} label={item.label} />
                );
            }
        })
        return ret;
    }

    return (
        <div className='d-flex'>
            <FormGroup className='d-flex flex-row w-100'>
                {results[0] ?
                    <FormControlLabel control={<Checkbox checked={true} onChange={(e) => onAllChange(e)} />} label="All" />
                    :
                    <FormControlLabel control={<Checkbox checked={false} onChange={(e) => onAllChange(e)} />} label="All" />
                }

                {renderItems(items)}
            </FormGroup>
        </div>
    );
})

export default CheckboxGroup;