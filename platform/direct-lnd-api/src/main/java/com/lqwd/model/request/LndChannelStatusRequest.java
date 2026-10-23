package com.lqwd.model.request;

import lombok.Data;

import javax.validation.constraints.NotNull;

@Data
public class LndChannelStatusRequest {

    @NotNull(message = "Channel Id is required")
    private String channelId;



}
