package com.lqwd.model.response;

import lombok.Builder;
import lombok.Data;

import java.util.Date;
import java.util.List;

@Builder
@Data
public class LndChannel {

    private boolean active;

    private String remote_pubkey;

    private String channel_point;

    private String chan_id;

    private String capacity;

    private String local_balance;

    private String remote_balance;

    private String commit_fee;

    private String commit_weight;

    private String fee_per_kw;

    private String unsettled_balance;

    private String total_satoshis_sent;

    private String total_satoshis_received;

    private boolean initiator;

    private Date last_updated;

    private String status;

}
