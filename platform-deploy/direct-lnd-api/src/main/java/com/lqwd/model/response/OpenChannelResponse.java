package com.lqwd.model.response;

import lombok.Data;

@Data
public class OpenChannelResponse {
    private String funding_txid_bytes;
    private int output_index;
    private boolean success;
    private String error;
}
