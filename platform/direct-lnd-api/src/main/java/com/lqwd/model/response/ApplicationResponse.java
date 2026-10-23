package com.lqwd.model.response;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import javax.persistence.*;
import java.io.Serializable;
import java.util.Date;

@Data
@Builder
@AllArgsConstructor
@NoArgsConstructor
public class ApplicationResponse implements Serializable {

    private Long id;

    private String productInfo;

    private String goal;

    private String currentSolution;

    private String companyName;

    private String contactName;

    private String contactEmail;

    private String contactPhone;

    private String companyAddress;

    private String countryCode;

    private String zipCode;

    private String companyUrl;

    private boolean hasKyc;

}
