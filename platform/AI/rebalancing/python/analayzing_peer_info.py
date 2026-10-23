from datetime import datetime
import ast

# time_lock_delta: 144
# This parameter represents the number of blocks that need to be mined before a Lightning Network payment channel can be closed unilaterally by one party. Each block takes a certain amount of time to be mined, so this value essentially determines the time delay for the channel closure.
#
# min_htlc: '1000'
# This is the minimum amount, expressed in a unit of the cryptocurrency being used, that can be transferred through a payment channel using the Lightning Network. In this case, it's set to 1000 units.
#
# fee_base_msat: '1000'
# The base fee is a fixed amount that is charged for routing a payment through the Lightning Network. It's typically expressed in milli-satoshis (msat), which are the smaller units of a Bitcoin. In this case, the base fee is set to 1000 milli-satoshis.
#
# fee_rate_milli_msat: '100'
# The fee rate represents an additional fee charged for routing a payment, and it's calculated based on the amount being transferred. It's also expressed in milli-satoshis per milli-satoshi per block. A higher fee rate generally indicates a faster confirmation time for the payment. Here, the fee rate is set to 100 milli-satoshis per milli-satoshi.
#
# disabled: False
# This parameter indicates whether the Lightning Network channel is disabled (True) or enabled (False). If it's set to True, the channel won't be usable for transactions.
#
# max_htlc_msat: '568800000'
# The maximum htlc (hash time-locked contract) amount specifies the largest payment that can be forwarded through a payment channel. It's also expressed in milli-satoshis. In this case, the maximum HTLC amount is set to 568,800,000 milli-satoshis.
#
# last_update: '04-08-23 11:07'
# This timestamp indicates the date and time of the last update to the channel's settings. It's provided in the format 'MM-DD-YY HH:MM', where MM represents the month, DD represents the day, YY represents the year, HH represents the hour, and MM represents the minutes.




# Read data from the text file
read_file_name = '05.txt'
with open(read_file_name, 'r') as file:
    data_string = file.read()

# Convert the data string into a dictionary
data = ast.literal_eval(data_string)

num_channels = data['num_channels']
info_string = f"Number of total Channels: {num_channels}\n\n"
i = 0
# Extracting information from the dictionary
for channel in data['channels']:
    interesting = False
    node1_pub = channel['node1_pub']
    node2_pub = channel['node2_pub']
    node1_policy = channel['node1_policy']
    node2_policy = channel['node2_policy']

    if node1_policy and 'last_update' in node1_policy:
        last_update_timestamp = node1_policy['last_update']
        last_update_datetime = datetime.fromtimestamp(last_update_timestamp)
        formatted_last_update = last_update_datetime.strftime('%d-%m-%y %H:%M')
        node1_policy['last_update'] = formatted_last_update

        if node2_policy != "None" and node2_policy and 'last_update' in node2_policy:
            last_update_timestamp = node2_policy['last_update']
            last_update_datetime = datetime.fromtimestamp(int(last_update_timestamp))
            formatted_last_update = last_update_datetime.strftime('%d-%m-%y %H:%M')
            node2_policy['last_update'] = formatted_last_update
            interesting = True
            i = i + 1
    if interesting :
        info_string += "Channel Information:\n"
        info_string += f"Node1 Pub Key: {node1_pub}\n"
        info_string += f"Node2 Pub Key: {node2_pub}\n"
        info_string += f"Node1 Policy: {node1_policy}\n"
        info_string += f"Node2 Policy: {node2_policy}\n"
        info_string += "-" * 30 + "\n"
info_string += f"Total interesting number of channels: {i}"

with open('channels_info_'+read_file_name+'.txt', 'w') as file:
    file.write(info_string)

print("Information saved to channels_info.txt")
