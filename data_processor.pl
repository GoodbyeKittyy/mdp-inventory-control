#!/usr/bin/perl
use strict;
use warnings;
use JSON;
use POSIX qw(ceil floor);
use List::Util qw(sum max min);
use Data::Dumper;

package MDPDataProcessor;

sub new {
    my ($class, %config) = @_;
    my $self = {
        max_inventory => $config{max_inventory} // 100,
        demand_data => [],
        inventory_data => [],
        revenue_data => [],
        cost_data => [],
        statistics => {},
    };
    bless $self, $class;
    return $self;
}

sub load_simulation_data {
    my ($self, $filename) = @_;
    
    open(my $fh, '<', $filename) or die "Cannot open file: $!";
    my $json_text = do { local $/; <$fh> };
    close($fh);
    
    my $data = decode_json($json_text);
    
    if (exists $data->{trajectory}) {
        foreach my $step (@{$data->{trajectory}}) {
            push @{$self->{demand_data}}, $step->{demand};
            push @{$self->{inventory_data}}, $step->{state};
            push @{$self->{revenue_data}}, $step->{reward} > 0 ? $step->{reward} : 0;
            push @{$self->{cost_data}}, $step->{reward} < 0 ? abs($step->{reward}) : 0;
        }
    }
    
    return scalar @{$self->{demand_data}};
}

sub calculate_statistics {
    my ($self) = @_;
    
    $self->{statistics} = {
        demand => $self->_compute_stats($self->{demand_data}),
        inventory => $self->_compute_stats($self->{inventory_data}),
        revenue => $self->_compute_stats($self->{revenue_data}),
        cost => $self->_compute_stats($self->{cost_data}),
    };
    
    $self->{statistics}->{stockout_rate} = $self->_calculate_stockout_rate();
    $self->{statistics}->{service_level} = 1.0 - $self->{statistics}->{stockout_rate};
    $self->{statistics}->{inventory_turnover} = $self->_calculate_turnover();
    
    return $self->{statistics};
}

sub _compute_stats {
    my ($self, $data) = @_;
    
    return {} unless @$data;
    
    my $n = scalar @$data;
    my $sum = sum(@$data);
    my $mean = $sum / $n;
    
    my $variance = sum(map { ($_ - $mean) ** 2 } @$data) / $n;
    my $std_dev = sqrt($variance);
    
    my @sorted = sort { $a <=> $b } @$data;
    my $median = $n % 2 ? $sorted[$n/2] : ($sorted[$n/2-1] + $sorted[$n/2]) / 2;
    
    return {
        mean => sprintf("%.2f", $mean),
        median => sprintf("%.2f", $median),
        std_dev => sprintf("%.2f", $std_dev),
        min => min(@$data),
        max => max(@$data),
        sum => sprintf("%.2f", $sum),
        count => $n,
    };
}

sub _calculate_stockout_rate {
    my ($self) = @_;
    
    my $stockout_count = 0;
    
    for (my $i = 0; $i < @{$self->{inventory_data}}; $i++) {
        if ($self->{demand_data}[$i] > $self->{inventory_data}[$i]) {
            $stockout_count++;
        }
    }
    
    my $total = scalar @{$self->{inventory_data}};
    return $total > 0 ? sprintf("%.4f", $stockout_count / $total) : 0;
}

sub _calculate_turnover {
    my ($self) = @_;
    
    my $total_demand = sum(@{$self->{demand_data}}) // 0;
    my $avg_inventory = sum(@{$self->{inventory_data}}) / scalar(@{$self->{inventory_data}});
    
    return $avg_inventory > 0 ? sprintf("%.2f", $total_demand / $avg_inventory) : 0;
}

sub generate_time_series_report {
    my ($self) = @_;
    
    my @report;
    push @report, "Time Series Analysis Report";
    push @report, "=" x 60;
    push @report, "";
    
    for (my $i = 0; $i < min(30, scalar @{$self->{demand_data}}); $i++) {
        my $line = sprintf(
            "Period %3d: Inventory=%3d, Demand=%3d, Revenue=\$%7.2f, Cost=\$%7.2f",
            $i + 1,
            $self->{inventory_data}[$i] // 0,
            $self->{demand_data}[$i] // 0,
            $self->{revenue_data}[$i] // 0,
            $self->{cost_data}[$i] // 0
        );
        push @report, $line;
    }
    
    return join("\n", @report);
}

sub generate_summary_report {
    my ($self) = @_;
    
    my $stats = $self->{statistics};
    
    my @report;
    push @report, "MDP Inventory Control - Summary Report";
    push @report, "=" x 60;
    push @report, "";
    
    push @report, "Demand Statistics:";
    push @report, sprintf("  Mean: %s", $stats->{demand}->{mean});
    push @report, sprintf("  Std Dev: %s", $stats->{demand}->{std_dev});
    push @report, sprintf("  Min: %d, Max: %d", $stats->{demand}->{min}, $stats->{demand}->{max});
    push @report, "";
    
    push @report, "Inventory Statistics:";
    push @report, sprintf("  Mean: %s", $stats->{inventory}->{mean});
    push @report, sprintf("  Std Dev: %s", $stats->{inventory}->{std_dev});
    push @report, sprintf("  Min: %d, Max: %d", $stats->{inventory}->{min}, $stats->{inventory}->{max});
    push @report, "";
    
    push @report, "Financial Statistics:";
    push @report, sprintf("  Total Revenue: \$%s", $stats->{revenue}->{sum});
    push @report, sprintf("  Total Cost: \$%s", $stats->{cost}->{sum});
    push @report, sprintf("  Net Profit: \$%.2f", $stats->{revenue}->{sum} - $stats->{cost}->{sum});
    push @report, "";
    
    push @report, "Performance Metrics:";
    push @report, sprintf("  Stockout Rate: %.2f%%", $stats->{stockout_rate} * 100);
    push @report, sprintf("  Service Level: %.2f%%", $stats->{service_level} * 100);
    push @report, sprintf("  Inventory Turnover: %s", $stats->{inventory_turnover});
    push @report, "";
    
    return join("\n", @report);
}

sub export_processed_data {
    my ($self, $filename) = @_;
    
    my $output = {
        statistics => $self->{statistics},
        time_series => {
            demand => $self->{demand_data},
            inventory => $self->{inventory_data},
            revenue => $self->{revenue_data},
            cost => $self->{cost_data},
        },
        metadata => {
            records => scalar @{$self->{demand_data}},
            generated_at => scalar localtime,
        }
    };
    
    open(my $fh, '>', $filename) or die "Cannot write file: $!";
    print $fh encode_json($output);
    close($fh);
    
    print "Processed data exported to: $filename\n";
}

sub analyze_policy_effectiveness {
    my ($self, $policy_file) = @_;
    
    open(my $fh, '<', $policy_file) or die "Cannot open policy file: $!";
    my $policy_json = do { local $/; <$fh> };
    close($fh);
    
    my $policy_data = decode_json($policy_json);
    
    my %effectiveness;
    $effectiveness{total_states} = scalar keys %{$policy_data->{policy}};
    $effectiveness{active_ordering_states} = 0;
    $effectiveness{average_order_size} = 0;
    
    my $total_orders = 0;
    my $order_count = 0;
    
    foreach my $state (keys %{$policy_data->{policy}}) {
        my $action = $policy_data->{policy}->{$state};
        if ($action > 0) {
            $effectiveness{active_ordering_states}++;
            $total_orders += $action;
            $order_count++;
        }
    }
    
    $effectiveness{average_order_size} = $order_count > 0 ? 
        sprintf("%.2f", $total_orders / $order_count) : 0;
    
    $effectiveness{ordering_frequency} = sprintf("%.2f%%", 
        ($effectiveness{active_ordering_states} / $effectiveness{total_states}) * 100);
    
    return \%effectiveness;
}

sub main {
    print "=== MDP Data Processor ===\n\n";
    
    my $processor = MDPDataProcessor->new(max_inventory => 100);
    
    print "Processing simulation data...\n";
    
    my @sample_demand = map { int(rand(15) + 5) } 1..50;
    my @sample_inventory = map { int(rand(80) + 20) } 1..50;
    my @sample_revenue = map { rand(200) + 50 } 1..50;
    my @sample_cost = map { rand(100) + 20 } 1..50;
    
    $processor->{demand_data} = \@sample_demand;
    $processor->{inventory_data} = \@sample_inventory;
    $processor->{revenue_data} = \@sample_revenue;
    $processor->{cost_data} = \@sample_cost;
    
    print "Calculating statistics...\n";
    $processor->calculate_statistics();
    
    print "\n" . $processor->generate_summary_report() . "\n\n";
    
    print "Generating time series report...\n";
    my $time_series = $processor->generate_time_series_report();
    
    open(my $fh, '>', 'time_series_report.txt') or die "Cannot write report: $!";
    print $fh $time_series;
    close($fh);
    print "Time series report saved to: time_series_report.txt\n\n";
    
    $processor->export_processed_data('processed_mdp_data.json');
    
    print "\n=== Processing Complete ===\n";
}

main() unless caller();

1;