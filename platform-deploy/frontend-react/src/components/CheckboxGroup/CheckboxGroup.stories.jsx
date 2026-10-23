import React from 'react';
import CheckboxGroup from './CheckboxGroup';

export default {
    title: 'Components/Checkbox Group',
    component: CheckboxGroup,
};

const onChange = (results) =>  {
    console.log(results)
}

let items = [
    {
        label: 'Spend'
    },
    {
        label: 'Receive'
    }
]

export const primary = () => {
    return (
        <div>
            <CheckboxGroup items={items} onChange={onChange} />
        </div>
    );
};
